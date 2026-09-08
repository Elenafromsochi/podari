const ORIGIN_WEBHOOK = "https://23podari.ru/api/public/telegram/webhook";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "podari-telegram-relay" });
    }

    if (request.method !== "POST" || url.pathname !== "/telegram/webhook") {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-podari-relay", "cloudflare-worker");

    try {
      const body = await request.arrayBuffer();
      return await fetch(ORIGIN_WEBHOOK, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
      });
    } catch (error) {
      console.error("Podari webhook relay failed", error);
      return new Response("Bad Gateway", { status: 502 });
    }
  },
};
