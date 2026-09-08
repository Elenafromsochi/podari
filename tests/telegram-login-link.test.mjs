import assert from "node:assert/strict";
import test from "node:test";

import {
  telegramLoginUrl,
  telegramLoginWebhookReply,
} from "../src/lib/telegram-login-link.ts";

test("confirmation button carries the approved login nonce", () => {
  assert.equal(
    telegramLoginUrl("https://23podari.ru", "abc_DEF-123"),
    "https://23podari.ru/?login=abc_DEF-123",
  );
});

test("login nonce replaces an existing login parameter", () => {
  assert.equal(
    telegramLoginUrl("https://23podari.ru/?login=old", "new_nonce"),
    "https://23podari.ru/?login=new_nonce",
  );
});

test("webhook reply sends the login button without an outbound Bot API call", () => {
  assert.deepEqual(
    telegramLoginWebhookReply("https://23podari.ru", "approved_nonce", 123),
    {
      method: "sendMessage",
      chat_id: 123,
      text: "✅ Вход подтверждён 💚",
      reply_markup: {
        inline_keyboard: [[
          {
            text: "Открыть приложение «Подари»",
            url: "https://23podari.ru/?login=approved_nonce",
          },
        ]],
      },
    },
  );
});
