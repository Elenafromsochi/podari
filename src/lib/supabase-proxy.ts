// HTTP proxy for clients built with VITE_SUPABASE_URL=<site>/db.
// WebSocket upgrades require a reverse proxy with explicit upgrade support.
export const DB_PROXY_PREFIX = "/db/";

export async function proxySupabaseRequest(request: Request): Promise<Response> {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("[db-proxy] SUPABASE_URL не задан");
    return new Response("Bad Gateway", { status: 502 });
  }
  const url = new URL(request.url);
  const targetUrl =
    supabaseUrl.replace(/\/$/, "") + url.pathname.slice(DB_PROXY_PREFIX.length - 1) + url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    init.body = request.body;
    // Node's fetch requires duplex for a ReadableStream request body.
    // Keep streaming uploads instead of buffering potentially large files.
    init.duplex = "half";
  }

  try {
    return await fetch(targetUrl, init);
  } catch (error) {
    console.error("[db-proxy] FAILED", error);
    return new Response("Bad Gateway", { status: 502 });
  }
}
