import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { proxySupabaseRequest } from "../src/lib/supabase-proxy.ts";

const originalUrl = process.env.SUPABASE_URL;
const upstream = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url === "/redirect") {
    res.writeHead(307, { location: "/destination" });
    res.end();
    return;
  }
  res.writeHead(400, { "content-type": "application/json", "x-upstream": "received" });
  res.end(
    JSON.stringify({
      method: req.method,
      path: req.url,
      host: req.headers.host,
      apikey: req.headers.apikey,
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString(),
    }),
  );
});

before(async () => {
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  process.env.SUPABASE_URL = `http://127.0.0.1:${upstream.address().port}/`;
});

after(async () => {
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  await new Promise((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
});

for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  test(`${method}: forwards the streamed body and returns the upstream response`, async () => {
    const body = JSON.stringify({ refresh_token: "invalid-local-test-token" });
    const request = new Request("https://podari.test/db/auth/v1/token?grant_type=refresh_token", {
      method,
      body,
      headers: {
        "content-type": "application/json",
        host: "podari.test",
        apikey: "test-anon",
        authorization: "Bearer test-token",
      },
    });
    const response = await proxySupabaseRequest(request);
    assert.equal(response.status, 400, "upstream validation error must not become a proxy 502");
    assert.equal(response.headers.get("x-upstream"), "received");
    const received = await response.json();
    assert.equal(received.method, method);
    assert.equal(received.path, "/auth/v1/token?grant_type=refresh_token");
    assert.equal(received.body, body);
    assert.equal(received.apikey, "test-anon");
    assert.equal(received.authorization, "Bearer test-token");
    assert.equal(received.host, new URL(process.env.SUPABASE_URL).host);
  });
}

for (const method of ["GET", "HEAD", "POST"]) {
  test(`${method}: supports a request without a body`, async () => {
    const response = await proxySupabaseRequest(
      new Request("https://podari.test/db/auth/v1/health", { method }),
    );
    assert.equal(response.status, 400);
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.equal((await response.json()).body, "");
  });
}

test("does not follow upstream redirects", async () => {
  const response = await proxySupabaseRequest(new Request("https://podari.test/db/redirect"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/destination");
  await response.text();
});
