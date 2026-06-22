import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tgApiSafe } from "@/lib/telegram-api";

const APP_URL = process.env.APP_URL ?? "https://23podari.ru";

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

async function sendTgMessage(chatId: number, text: string) {
  await tgApiSafe("sendMessage", { chat_id: chatId, text });
}

async function sendLoginConfirmed(chatId: number) {
  await tgApiSafe("sendMessage", {
    chat_id: chatId,
    text: "✅ Вход подтверждён. Возвращайся в приложение 💚",
  });
}

// Оплата звёздами (Telegram Stars): начисляем/продлеваем Global-подписку.
// payload формата "global:<user_id>:<days>" приходит из createGlobalInvoice.
async function handleSuccessfulPayment(
  chatId: number,
  payload: string,
): Promise<void> {
  const parts = payload.split(":");
  if (parts[0] !== "global") return;
  const userId = parts[1];
  const days = Number(parts[2] || "30") || 30;
  if (!userId) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = supabaseAdmin as any;
  const { data } = await admin
    .from("profiles")
    .select("premium_until")
    .eq("user_id", userId)
    .maybeSingle();

  // Продлеваем от текущего срока, если он ещё активен, иначе от сегодня.
  const current = data?.premium_until ? new Date(data.premium_until) : null;
  const base = current && current.getTime() > Date.now() ? current : new Date();
  base.setDate(base.getDate() + days);

  await admin
    .from("profiles")
    .update({ premium_until: base.toISOString() })
    .eq("user_id", userId);

  const until = base.toLocaleDateString("ru-RU");
  await sendTgMessage(
    chatId,
    `✅ Global активирован до ${until}. Спасибо за поддержку! 💚`,
  );
}


export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (!WEBHOOK_SECRET) {
          return new Response("Not configured", { status: 500 });
        }
        const actual =
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, WEBHOOK_SECRET)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = await request.json();

        // Колбэки больше не используем — авто-подтверждение по /start
        if (update.callback_query) {
          await tgApiSafe("answerCallbackQuery", {
            callback_query_id: update.callback_query.id,
          });
          return Response.json({ ok: true });
        }

        // ── Платежи звёздами (Telegram Stars) ──
        // Шаг 1: подтверждаем pre-checkout (нужно ответить за ~10 секунд).
        if (update.pre_checkout_query) {
          await tgApiSafe("answerPreCheckoutQuery", {
            pre_checkout_query_id: update.pre_checkout_query.id,
            ok: true,
          });
          return Response.json({ ok: true });
        }
        // Шаг 2: успешный платёж приходит как сообщение с successful_payment.
        {
          const pmsg = update.message;
          if (pmsg?.successful_payment && pmsg.chat?.id) {
            await handleSuccessfulPayment(
              pmsg.chat.id,
              String(pmsg.successful_payment.invoice_payload ?? ""),
            );
            return Response.json({ ok: true });
          }
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
                  approved_at: new Date().toISOString(),
                });
              if (!nErr) {
                await sendTgMessage(
                  chatId,
                  `Привет! 💚 Тебя пригласили в «Подари».\n\nОткрой ссылку, ты уже вошёл:\n${APP_URL}/?login=${nonce}\n\nТебе зачислится +1 балл, а пригласившему +50 опыта.`,
                );
                await sendLoginConfirmed(chatId);
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
              approved_at: new Date().toISOString(),
            })
            .eq("nonce", nonce);

          await sendLoginConfirmed(chatId);
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
