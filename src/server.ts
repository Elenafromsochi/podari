import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { runSleepingNudgeSweep } from "./lib/reengagement.server";

// Автоматическое напоминание «уснувшим» — только на self-hosted Node (systemd), где
// процесс живёт постоянно. На Cloudflare Workers (если когда-нибудь снова
// туда вернёмся) setInterval в изоляте не переживёт запрос — нужен будет
// отдельный Cron Trigger, поэтому явно проверяем рантайм.
if (typeof process !== "undefined" && process.versions?.node) {
  const HOUR_MS = 60 * 60 * 1000;
  setTimeout(() => void runSleepingNudgeSweep(), 60_000);
  setInterval(() => void runSleepingNudgeSweep(), 6 * HOUR_MS);
}

// Прокси к Supabase через собственный домен: браузер пользователя обращается
// только к 23podari.ru (у нас на Cloudflare — доступен без VPN), а уже сам
// Worker внутри ходит к настоящему Supabase напрямую (сервер-сервер, гео-
// блокировки его не касаются). Так вся работа с данными, авторизацией,
// картинками и realtime-чатом не требует VPN на стороне пользователя.
// Прозрачно пробрасывает метод/заголовки/тело/статус, включая апгрейд до
// WebSocket (для Supabase Realtime) — Cloudflare делает это тем же fetch().
const DB_PROXY_PREFIX = "/db/";

async function proxySupabaseRequest(request: Request): Promise<Response> {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("[db-proxy] SUPABASE_URL не задан");
    return new Response("Bad Gateway", { status: 502 });
  }
  const url = new URL(request.url);
  const targetUrl = supabaseUrl.replace(/\/$/, "") + url.pathname.slice(DB_PROXY_PREFIX.length - 1) + url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  try {
    return await fetch(targetUrl, init);
  } catch (error) {
    console.error("[db-proxy] FAILED", error);
    return new Response("Bad Gateway", { status: 502 });
  }
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

// Документ (HTML) не кэшируем «намертво»: браузер обязан каждый раз
// проверять у сервера, нет ли свежей версии. Так пользователи всегда
// получают последнюю сборку по одной и той же ссылке, без ручного сброса
// кэша. Сами JS/CSS имеют уникальные имена и кэшируются надолго отдельно.
function withFreshHtmlHeaders(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache, must-revalidate");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(DB_PROXY_PREFIX)) {
      return proxySupabaseRequest(request);
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withFreshHtmlHeaders(
        await normalizeCatastrophicSsrResponse(response),
      );
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
