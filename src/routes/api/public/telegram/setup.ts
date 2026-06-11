import { createFileRoute } from "@tanstack/react-router";

// Одноразовая настройка вебхука бота.
// Открыть в браузере один раз:
//   https://<сайт>/api/public/telegram/setup?key=<TELEGRAM_WEBHOOK_SECRET>
// Регистрирует вебхук в Telegram, чтобы бот слал сообщения в это приложение.
export const Route = createFileRoute("/api/public/telegram/setup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!secret || !token) {
          return new Response(
            "Не настроено: добавь TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET в переменные Cloudflare.",
            { status: 500 },
          );
        }
        const url = new URL(request.url);
        if (url.searchParams.get("key") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        const appUrl = process.env.APP_URL ?? `${url.protocol}//${url.host}`;
        const webhookUrl = `${appUrl}/api/public/telegram/webhook`;
        const res = await fetch(
          `https://api.telegram.org/bot${token}/setWebhook`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: webhookUrl,
              secret_token: secret,
              allowed_updates: ["message", "edited_message"],
            }),
          },
        );
        const data = await res.json().catch(() => ({}));
        return Response.json({ webhook_url: webhookUrl, telegram: data });
      },
    },
  },
});
