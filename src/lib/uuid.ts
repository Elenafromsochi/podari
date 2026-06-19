// Безопасный генератор UUID.
// crypto.randomUUID() поддерживается не везде (старый Safari, встроенный
// браузер Telegram на iOS), и его прямой вызов роняет страницу с ошибкой
// "crypto.randomUUID is not a function". Поэтому откатываемся по цепочке:
// randomUUID → getRandomValues (v4 вручную) → Math.random как крайний случай.
export function safeUUID(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // версия 4
    b[8] = (b[8] & 0x3f) | 0x80; // вариант 10xx
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
