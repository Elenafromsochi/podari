// Публичные/подписанные ссылки на Storage, сгенерированные на сервере
// (supabaseAdmin), по умолчанию ведут прямо на *.supabase.co — а нам нужно,
// чтобы браузер пользователя грузил их через свой домен (23podari.ru/db),
// иначе изображение не откроется без VPN так же, как раньше не открывался
// сам Supabase. Клиентские загрузки (uploadImage) уже проксируются сами —
// это только для ссылок, которые собирает сервер (например, фото из Telegram).
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const APP_URL = process.env.APP_URL ?? "https://23podari.ru";

export function toProxiedStorageUrl(url: string): string {
  if (!SUPABASE_URL || !url.startsWith(SUPABASE_URL)) return url;
  return APP_URL + "/db" + url.slice(SUPABASE_URL.length);
}
