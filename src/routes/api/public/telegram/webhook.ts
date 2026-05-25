import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function deriveWebhookSecret(apiKey: string) {
  return createHash("sha256")
    .update(`telegram-webhook:${apiKey}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

async function sendTgMessage(chatId: number, text: string) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    console.error("Telegram secrets missing");
    return;
  }
  await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
        if (!TELEGRAM_API_KEY) {
          return new Response("Not configured", { status: 500 });
        }
        const expected = deriveWebhookSecret(TELEGRAM_API_KEY);
        const actual =
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = await request.json();
        const msg = update.message ?? update.edited_message;
        const text: string = msg?.text ?? "";
        const chatId: number | undefined = msg?.chat?.id;
        const from = msg?.from;

        if (!chatId || !from) {
          return Response.json({ ok: true, ignored: true });
        }

        // /start <param>  — param может быть nonce для логина, либо ref_<uuid> для реферала
        const m = text.match(/^\/start(?:\s+(\S+))?/);
        if (m) {
          const param = m[1];

          // Реферальная ссылка: ref_<uuid>
          if (param && param.startsWith("ref_")) {
            const refId = param.slice(4);
            const isUuid =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                refId,
              );
            if (isUuid) {
              await supabaseAdmin
                .from("telegram_referrals")
                .upsert(
                  { telegram_id: from.id, referred_by: refId },
                  { onConflict: "telegram_id" },
                );

              // Сразу выдаём код — чтобы пользователь не возвращался в приложение за новым nonce
              const { randomBytes } = await import("crypto");
              const nonce = randomBytes(9).toString("base64url");
              const code = String(Math.floor(1000 + Math.random() * 9000));
              const { error: nErr } = await supabaseAdmin
                .from("auth_nonces")
                .insert({
                  nonce,
                  expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
                  referrer_id: refId,
                  code,
                  telegram_id: from.id,
                  telegram_username: from.username ?? null,
                  telegram_first_name: from.first_name ?? null,
                });
              if (!nErr) {
                await sendTgMessage(
                  chatId,
                  `Привет! 💚 Тебя пригласили в «Подари».\n\nТвой код для входа: ${code}\n\nВведи его на странице входа: https://podari.lovable.app/?ref=${refId}\n\nКод действует 5 минут. После входа тебе зачислится +1 балл, а пригласившему +50 опыта.`,
                );
                return Response.json({ ok: true });
              }
            }
            await sendTgMessage(
              chatId,
              `Привет! 💚\nТебя пригласили в «Подари». Открой https://podari.lovable.app/ и войди через Telegram.`,
            );
            return Response.json({ ok: true });
          }

          if (!param) {
            await sendTgMessage(
              chatId,
              `Привет! Чтобы войти в Подари, открой ссылку входа из приложения 💚`,
            );
            return Response.json({ ok: true });
          }

          const nonce = param;
          // Find nonce
          const { data: row } = await supabaseAdmin
            .from("auth_nonces")
            .select("nonce, expires_at, consumed_at")
            .eq("nonce", nonce)
            .maybeSingle();

          if (!row) {
            await sendTgMessage(
              chatId,
              `Ссылка не найдена. Открой кнопку «Войти через Telegram» в приложении ещё раз.`,
            );
            return Response.json({ ok: true });
          }
          if (row.consumed_at) {
            await sendTgMessage(chatId, `Эта ссылка уже использована.`);
            return Response.json({ ok: true });
          }
          if (new Date(row.expires_at).getTime() < Date.now()) {
            await sendTgMessage(
              chatId,
              `Срок ссылки истёк. Запроси новый код в приложении.`,
            );
            return Response.json({ ok: true });
          }

          const code = String(Math.floor(1000 + Math.random() * 9000));
          await supabaseAdmin
            .from("auth_nonces")
            .update({
              code,
              telegram_id: from.id,
              telegram_username: from.username ?? null,
              telegram_first_name: from.first_name ?? null,
            })
            .eq("nonce", nonce);

          await sendTgMessage(
            chatId,
            `🎁 Подари\nТвой код для входа: ${code}\n\nВведи его на странице входа: https://podari.lovable.app/\n\nКод действует 5 минут.`,
          );
          return Response.json({ ok: true });
        }

        await sendTgMessage(
          chatId,
          `Привет! Я бот сервиса «Подари» 🎁\nЧтобы войти, нажми «Войти через Telegram» в приложении.`,
        );
        return Response.json({ ok: true });
      },
    },
  },
});
