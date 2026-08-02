// Общий журнал «когда я последний раз открывал(а) этот чат» — единый для
// вкладки «Чаты» и для списков в профиле (брони/подаренное/полученное),
// чтобы отметка «непрочитано» была одинаковой везде, а не жила своей
// жизнью на каждом экране отдельно.
const SEEN_KEY = "cozy_chat_seen";

export function readSeenChats(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function writeSeenChats(m: Record<string, string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(m));
  } catch {
    /* noop */
  }
}

export type UnreadChatMeta = {
  transaction_id: string;
  last_message_at: string | null;
  last_incoming: boolean;
};

/** Непрочитанный = последнее сообщение от собеседника и пришло позже, чем мы в последний раз открывали этот чат. */
export function isChatUnread(item: UnreadChatMeta, seen: Record<string, string>): boolean {
  return (
    !!item.last_incoming &&
    !!item.last_message_at &&
    (seen[item.transaction_id] ?? "") < item.last_message_at
  );
}
