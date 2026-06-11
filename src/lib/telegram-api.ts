// Прямой вызов Telegram Bot API (вместо шлюза Lovable).
// Использует переменную окружения TELEGRAM_BOT_TOKEN.
export async function tgApi(
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN missing");
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[telegram] ${method} failed`, res.status, t);
    throw new Error("TELEGRAM_SEND_FAILED");
  }
  return res.json().catch(() => ({}));
}

// Безопасный вариант: не бросает исключение (для мест, где сбой отправки не критичен).
export async function tgApiSafe(
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    await tgApi(method, body);
  } catch (e) {
    console.error(`[telegram] ${method} ignored error`, e);
  }
}
