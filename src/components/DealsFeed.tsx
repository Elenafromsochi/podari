import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getDealsFeed } from "@/lib/cozy.functions";
import { supabase } from "@/integrations/supabase/client";

type Deal = Awaited<ReturnType<typeof getDealsFeed>>[number];

const KIND_LABEL: Record<string, string> = {
  used_item: "вещь",
  specialist_time: "время специалиста",
  treat: "угощение",
  event_invite: "приглашение",
};

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return `${d} д назад`;
}

export function DealsFeed() {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [pulse, setPulse] = useState(false);
  const load = useServerFn(getDealsFeed);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const rows = await load();
        if (mounted) setDeals(rows);
      } catch {
        if (mounted) setDeals([]);
      }
    };
    refresh();

    const channel = supabase
      .channel("deals-feed")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "transactions" },
        (payload) => {
          const next = (payload.new ?? {}) as { status?: string };
          if (next.status === "completed") {
            setPulse(true);
            setTimeout(() => setPulse(false), 1200);
            refresh();
          }
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [load]);

  if (deals === null) {
    return (
      <div className="mx-auto w-full max-w-md px-5">
        <div className="h-24 animate-pulse rounded-2xl border bg-muted/40" />
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="mx-auto w-full max-w-md px-5">
        <div className="rounded-2xl border bg-card px-4 py-5 text-center text-sm text-muted-foreground">
          Пока никто не вручил подарков 🌱 Будь первым!
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Лента сделок</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-mint/40 px-2.5 py-1 text-[11px] font-medium text-foreground transition ${
            pulse ? "scale-110" : ""
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 ${
              pulse ? "animate-ping" : "animate-pulse"
            }`}
          />
          в реальном времени
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {deals.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm"
          >
            {d.gift_image ? (
              <img
                src={d.gift_image}
                alt={d.gift_title}
                className="h-24 w-24 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-muted text-4xl">
                🎁
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm break-words">
                <span className="font-medium">{d.sender_name}</span>{" "}
                <span className="text-muted-foreground">вручил{" "}</span>
                <span className="font-medium">{d.gift_title}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {KIND_LABEL[d.gift_kind] ?? "подарок"} · {timeAgo(d.created_at)}
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
