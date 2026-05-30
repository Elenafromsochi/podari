import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const APP_URL = "https://podari.lovable.app";

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

async function tgCall(method: string, body: Record<string, unknown>) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    console.error("Telegram secrets missing");
    return;
  }
  await fetch(`https://connector-gateway.lovable.dev/telegram/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function sendTgMessage(chatId: number, text: string) {
  await tgCall("sendMessage", { chat_id: chatId, text });
}

async function sendConfirmPrompt(chatId: number, nonce: string) {
  await tgCall("sendMessage", {
    chat_id: chatId,
    text: "🎁 Подари\nПодтверди вход в приложение:",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Это я", callback_data: `approve:${nonce}` },
          { text: "🚫 Не я", callback_data: `reject:${nonce}` },
        ],
      ],
    },
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

        // ── Inline-кнопки: подтверждение/отклонение входа ──
        const cb = update.callback_query;
        if (cb) {
          const cbId: string = cb.id;
          const fromId: number | undefined = cb.from?.id;
          const data: string = cb.data ?? "";
          const [action, nonce] = data.split(":");
          const chatId: number | undefined = cb.message?.chat?.id;
          const messageId: number | undefined = cb.message?.message_id;

          if (!nonce || !fromId) {
            await tgCall("answerCallbackQuery", { callback_query_id: cbId });
            return Response.json({ ok: true });
          }

          const { data: row } = await supabaseAdmin
            .from("auth_nonces")
            .select("nonce, telegram_id, expires_at, consumed_at, approved_at, rejected_at")
            .eq("nonce", nonce)
            .maybeSingle();

          if (!row || row.consumed_at || row.approved_at || row.rejected_at) {
            await tgCall("answerCallbackQuery", {
              callback_query_id: cbId,
              text: "Эта ссылка уже использована",
            });
            return Response.json({ ok: true });
          }
          if (new Date(row.expires_at).getTime() < Date.now()) {
            await tgCall("answerCallbackQuery", {
              callback_query_id: cbId,
              text: "Ссылка истекла, запроси новую",
            });
            return Response.json({ ok: true });
          }
          if (Number(row.telegram_id) !== fromId) {
            await tgCall("answerCallbackQuery", {
              callback_query_id: cbId,
              text: "Эта ссылка не для тебя",
            });
            return Response.json({ ok: true });
          }

          if (action === "approve") {
            await supabaseAdmin
              .from("auth_nonces")
              .update({ approved_at: new Date().toISOString() })
              .eq("nonce", nonce);
            await tgCall("answerCallbackQuery", {
              callback_query_id: cbId,
              text: "Готово ✅",
            });
            if (chatId && messageId) {
              await tgCall("editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: "✅ Вход подтверждён. Возвращайся в приложение 💚",
              });
            }
          } else if (action === "reject") {
            await supabaseAdmin
              .from("auth_nonces")
              .update({ rejected_at: new Date().toISOString() })
              .eq("nonce", nonce);
            await tgCall("answerCallbackQuery", {
              callback_query_id: cbId,
              text: "Вход отклонён",
            });
            if (chatId && messageId) {
              await tgCall("editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: "🚫 Вход отклонён. Если это был не ты — всё в порядке.",
              });
            }
          } else {
            await tgCall("answerCallbackQuery", { callback_query_id: cbId });
          }
          return Response.json({ ok: true });
        }

        // ── Обычные сообщения ──
        const msg = update.message ?? update.edited_message;
        const text: string = msg?.text ?? "";
        const chatId: number | undefined = msg?.chat?.id;
        const from = msg?.from;

        if (!chatId || !from) {
          return Response.json({ ok: true, ignored: true });
        }

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

              const { randomBytes } = await import("crypto");
              const nonce = randomBytes(9).toString("base64url");
              const { error: nErr } = await supabaseAdmin
                .from("auth_nonces")
                .insert({
                  nonce,
                  expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
                  referrer_id: refId,
                  telegram_id: from.id,
                  telegram_username: from.username ?? null,
                  telegram_first_name: from.first_name ?? null,
                });
              if (!nErr) {
                await sendTgMessage(
                  chatId,
                  `Привет! 💚 Тебя пригласили в «Подари».\n\nОткрой ссылку и подтверди вход:\n${APP_URL}/?login=${nonce}\n\nПосле входа тебе зачислится +1 балл, а пригласившему +50 опыта.`,
                );
                await sendConfirmPrompt(chatId, nonce);
                return Response.json({ ok: true });
              }
            }
            await sendTgMessage(
              chatId,
              `Привет! 💚\nТебя пригласили в «Подари». Открой ${APP_URL}/ и нажми «Войти через Telegram».`,
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
          const { data: row } = await supabaseAdmin
            .from("auth_nonces")
            .select("nonce, expires_at, consumed_at, approved_at, rejected_at")
            .eq("nonce", nonce)
            .maybeSingle();

          if (!row) {
            await sendTgMessage(
              chatId,
              `Ссылка не найдена. Открой кнопку «Войти через Telegram» в приложении ещё раз.`,
            );
            return Response.json({ ok: true });
          }
          if (row.consumed_at || row.approved_at || row.rejected_at) {
            await sendTgMessage(chatId, `Эта ссылка уже использована.`);
            return Response.json({ ok: true });
          }
          if (new Date(row.expires_at).getTime() < Date.now()) {
            await sendTgMessage(
              chatId,
              `Срок ссылки истёк. Запроси новый вход в приложении.`,
            );
            return Response.json({ ok: true });
          }

          await supabaseAdmin
            .from("auth_nonces")
            .update({
              telegram_id: from.id,
              telegram_username: from.username ?? null,
              telegram_first_name: from.first_name ?? null,
            })
            .eq("nonce", nonce);

          await sendConfirmPrompt(chatId, nonce);
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
