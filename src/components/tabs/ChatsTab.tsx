import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getMyChats } from "@/lib/cozy.functions";
import { haptic } from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteToAdminButton } from "@/components/WriteToAdminDialog";
import { readSeenChats, writeSeenChats, isChatUnread } from "@/lib/chat-unread";


type ChatItem = {
  transaction_id: string;
  status: string;
  gift_id: string;
  gift_title: string;
  gift_image: string | null;
  other_name: string;
  created_at: string;
  last_message_at: string | null;
  last_incoming: boolean;
  needs_review?: boolean;
};

type Filter = "givers" | "receivers" | "archive";

function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "сейчас";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "В резерве", cls: "bg-peach/60 text-peach-foreground" },
    completed: { label: "Завершено", cls: "bg-mint/60 text-mint-foreground" },
    cancelled: { label: "Отменено", cls: "bg-muted text-muted-foreground" },
  };
  const t = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.cls}`}>
      {t.label}
    </span>
  );
}

function TabBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9.5px] font-bold leading-none text-primary-foreground">
      {n > 9 ? "9+" : n}
    </span>
  );
}

// Отдельный, визуально другой значок для «жди отзыв» — в отличие от
// непрочитанных сообщений, он не должен гаснуть от одного захода на вкладку,
// поэтому важно не путать его с обычным counter-бейджем.
function ReviewBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span
      className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9.5px] font-bold leading-none text-amber-950"
      title="Ждут отзыва"
      aria-label="Ждут отзыва"
    >
      ✍️{n > 9 ? "9+" : n}
    </span>
  );
}

export function ChatsTab() {
  const [filter, setFilter] = useState<Filter>("givers");

  const [givers, setGivers] = useState<ChatItem[] | null>(null);
  const [receivers, setReceivers] = useState<ChatItem[] | null>(null);
  const [archiveG, setArchiveG] = useState<ChatItem[]>([]);
  const [archiveR, setArchiveR] = useState<ChatItem[]>([]);
  const [seen, setSeen] = useState<Record<string, string>>(() => readSeenChats());
  const chatsFn = useServerFn(getMyChats);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const c = (await chatsFn()) as {
          with_givers: ChatItem[];
          with_receivers: ChatItem[];
          archive_with_givers?: ChatItem[];
          archive_with_receivers?: ChatItem[];
        };
        if (!alive) return;
        setGivers(c.with_givers ?? []);
        setReceivers(c.with_receivers ?? []);
        setArchiveG(c.archive_with_givers ?? []);
        setArchiveR(c.archive_with_receivers ?? []);
      } catch {
        /* нет связи — оставляем прежний список */
      }
    };
    load();
    // Обновляем список при возврате в приложение и после завершения сделки —
    // иначе завершённый чат «зависает» в активных, пока не перезагрузишь.
    const onFocus = () => load();
    const onChanged = () => load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("cozy:chats-changed", onChanged);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("cozy:chats-changed", onChanged);
    };
  }, [chatsFn]);

  const isUnread = (c: ChatItem) => isChatUnread(c, seen);

  const markSeen = (c: ChatItem) => {
    if (!c.last_message_at) return;
    setSeen((prev) => {
      if ((prev[c.transaction_id] ?? "") >= c.last_message_at!) return prev;
      const next = { ...prev, [c.transaction_id]: c.last_message_at! };
      writeSeenChats(next);
      return next;
    });
  };

  const countUnread = (arr: ChatItem[]) => arr.reduce((n, c) => n + (isUnread(c) ? 1 : 0), 0);
  const giversUnread = countUnread(givers ?? []);
  const receiversUnread = countUnread(receivers ?? []);
  const archiveUnread = countUnread([...archiveG, ...archiveR]);
  // Сколько завершённых сделок ждут отзыв — чтобы «висящее» уведомление
  // в архиве было заметно, а не молча терялось.
  const countNeedsReview = (arr: ChatItem[]) =>
    arr.reduce((n, c) => n + (c.needs_review ? 1 : 0), 0);
  const archiveNeedsReview = countNeedsReview([...archiveG, ...archiveR]);
  const unreadByTab: Record<Filter, number> = {
    givers: giversUnread,
    receivers: receiversUnread,
    archive: archiveUnread,
  };

  const base: ChatItem[] = useMemo(() => {
    if (filter === "givers") return givers ?? [];
    if (filter === "receivers") return receivers ?? [];
    return [...archiveG, ...archiveR];
  }, [filter, givers, receivers, archiveG, archiveR]);

  // Чаты с незавершённой задачей (например, «оставьте отзыв») поднимаем
  // наверх списка — остальные идут следом в прежнем порядке.
  const list = useMemo(
    () => [...base].sort((a, b) => (a.needs_review === b.needs_review ? 0 : a.needs_review ? -1 : 1)),
    [base],
  );

  const loading =
    (filter === "givers" && !givers) || (filter === "receivers" && !receivers);

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-7">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Чаты</h1>
          <p className="text-sm text-muted-foreground">
            Общение по подаркам и сделкам
          </p>
        </div>
        <WriteToAdminButton />
      </header>


      {/* Segmented control */}
      <div
        data-tour="chat-filters"
        className="mb-4 grid grid-cols-3 gap-1 rounded-2xl border bg-muted/60 p-1"
      >
        {([
          ["givers", "С дарителями"],
          ["receivers", "С получателями"],
          ["archive", "Архив"],
        ] as const).map(([k, label]) => {
          const active = filter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                if (!active) {
                  haptic("select");
                  setFilter(k);
                }
              }}
              className={`flex items-center justify-center rounded-xl px-2 py-1.5 text-[11.5px] font-medium leading-tight transition-all duration-300 ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              <TabBadge n={unreadByTab[k]} />
              {k === "archive" && <ReviewBadge n={archiveNeedsReview} />}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {filter === "archive"
            ? "Архив пуст"
            : "Здесь пока нет активных чатов"}
        </div>
      ) : (
        <ul key={filter} className="achievements-list space-y-2">
          {list.map((c) => {
            const unread = isUnread(c);
            return (
              <li key={c.transaction_id}>
                <Link
                  to="/chat/$giftId"
                  params={{ giftId: c.gift_id }}
                  onClick={() => {
                    haptic("select");
                    markSeen(c);
                  }}
                  className={`flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition active:scale-[0.98] ${
                    unread
                      ? "border-primary/40 bg-primary/5"
                      : c.needs_review
                        ? "border-amber-400/50 bg-amber-400/5"
                        : "bg-card"
                  }`}
                >
                  {c.gift_image ? (
                    <img
                      src={c.gift_image}
                      alt={c.gift_title}
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                      🎁
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${unread ? "font-bold" : "font-semibold"}`}>
                        {c.other_name}
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {unread && (
                          <span className="h-2 w-2 rounded-full bg-primary" aria-label="новое сообщение" />
                        )}
                        <span className="text-[10.5px] text-muted-foreground">
                          {timeAgo(c.last_message_at ?? c.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className={`truncate text-xs ${unread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {unread ? "● Новое сообщение" : `🎁 ${c.gift_title}`}
                      </p>
                      <StatusTag status={c.status} />
                    </div>
                    {c.needs_review && (
                      <p className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                        ✍️ Оставьте отзыв о сделке
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
