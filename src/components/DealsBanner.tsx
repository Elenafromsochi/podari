import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Sparkles } from "lucide-react";
import { getDealsBanner } from "@/lib/cozy.functions";
import { loadUser } from "@/lib/auth-state";

type Deal = {
  transaction_id: string;
  gift_id: string;
  gift_title: string;
  role: "giver" | "receiver";
  handover_requested: boolean;
};

type BannerData = {
  pending_count: number;
  unread_msgs: number;
  deals: Deal[];
};

/**
 * Показывает прилипший к верху баннер с активными сделками
 * и непрочитанными сообщениями — чтобы быстрее доводить до закрытия.
 */
export function DealsBanner() {
  const [data, setData] = useState<BannerData | null>(null);
  const [hasUser, setHasUser] = useState(false);
  const fetchBanner = useServerFn(getDealsBanner);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const u = await loadUser();
      if (cancelled) return;
      if (!u) {
        setHasUser(false);
        setData(null);
        return;
      }
      setHasUser(true);
      try {
        const lastSeen =
          typeof window !== "undefined"
            ? localStorage.getItem("cozy_last_seen_chats")
            : null;
        const res = (await fetchBanner({
          data: { last_seen_chats_at: lastSeen },
        })) as BannerData;
        if (!cancelled) setData(res);
      } catch {
        /* noop */
      }
    };
    load();
    const refresh = () => load();
    if (typeof window !== "undefined") {
      window.addEventListener("cozy:chats-activity", refresh);
      window.addEventListener("cozy:gifts-activity", refresh);
    }
    const id = window.setInterval(load, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (typeof window !== "undefined") {
        window.removeEventListener("cozy:chats-activity", refresh);
        window.removeEventListener("cozy:gifts-activity", refresh);
      }
    };
  }, [fetchBanner]);

  if (!hasUser || !data) return null;
  if (data.pending_count === 0 && data.unread_msgs === 0) return null;

  const single = data.deals[0];
  const linkTo = single
    ? { to: "/chat/$giftId" as const, params: { giftId: single.gift_id } }
    : { to: "/" as const, search: { tab: "chats" } as never };

  return (
    <div className="sticky top-0 z-40 w-full bg-mint/95 backdrop-blur supports-[backdrop-filter]:bg-mint/80 shadow-sm">
      <Link
        {...linkTo}
        className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-3 text-mint-foreground hover:bg-mint"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/60">
          {data.unread_msgs > 0 ? (
            <MessageCircle className="h-5 w-5" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {data.unread_msgs > 0
              ? `Новые сообщения (${data.unread_msgs}) — доведи сделку до конца 💚`
              : single
              ? single.role === "giver"
                ? `Твой подарок «${single.gift_title}» ждёт встречи`
                : `Сделка «${single.gift_title}» в процессе`
              : `Активных сделок: ${data.pending_count}`}
          </p>
          <p className="truncate text-xs opacity-80">
            {single
              ? single.role === "giver"
                ? "Открой чат и согласуй передачу"
                : "Открой чат с дарителем"
              : "Открой кабинет, чтобы продолжить"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-background/70 px-3 py-1 text-xs font-semibold">
          Открыть →
        </span>
      </Link>
    </div>
  );
}
