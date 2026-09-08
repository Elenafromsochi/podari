export function telegramLoginUrl(appUrl: string, nonce: string): string {
  const url = new URL(appUrl);
  url.searchParams.set("login", nonce);
  return url.toString();
}

export function telegramLoginWebhookReply(
  appUrl: string,
  nonce: string,
  chatId: number,
  text = "✅ Вход подтверждён 💚",
) {
  return {
    method: "sendMessage" as const,
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [[
        {
          text: "Открыть приложение «Подари»",
          url: telegramLoginUrl(appUrl, nonce),
        },
      ]],
    },
  };
}
