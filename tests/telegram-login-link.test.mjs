import assert from "node:assert/strict";
import test from "node:test";

import { telegramLoginUrl } from "../src/lib/telegram-login-link.ts";

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
