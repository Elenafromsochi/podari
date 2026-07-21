import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { requestHandover } from "@/lib/cozy.functions";

const LAST_SEEN_KEY = "cozygift_last_seen_handovers";

function readLastSeen(): string {
  if (typeof localStorage === "undefined") return new Date(0).toISOString();
  try {
    return localStorage.getItem(LAST_SEEN_KEY) ?? new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function writeLastSeen(iso: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_SEEN_KEY, iso);
  } catch {
    /* noop */
  }
}

/**
 * Глобальный слушатель: показывает лёгкий тост сверху (с крестиком —
 * закрывается) для брони подарка — как для тех, что случились прямо
 * сейчас, так и для тех, что случились, пока человека не было в сервисе
 * (с прошлого визита). Не копит бесконечный «хвост»: старые/давно
 * виденные брони тостами не всплывают — их можно разобрать в профиле
 * («Забронировали у вас»), это по желанию, не навязчиво.
 * Монтируется один раз в __root.tsx и работает на любом маршруте.
 */
export function GlobalNotifications() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  const requestHandoverFn = useServerFn(requestHandover);

  useEffect(() => {
    let mounted = true;
    loadUser().then((u) => mounted && setUser(u));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) setUser(null);
      else loadUser().then((u) => mounted && setUser(u));
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const showClaimedToast = (tx: { id: string; gift_id: string }, title: string, image: string | null) => {
    const confirm = async (dismiss: () => void) => {
      try {
        await requestHandoverFn({ data: { transaction_id: tx.id } });
        toast.success("Передача отмечена 💚", {
          description: "Получатель подтвердит — и сделка завершится",
        });
        window.dispatchEvent(new CustomEvent("cozy:chats-changed"));
      } catch (e) {
        toast.error("Не удалось подтвердить", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        dismiss();
      }
    };

    toast.custom(
      (t) => (
        <div className="flex w-full max-w-sm items-center gap-3 rounded-2xl border bg-card p-3 shadow-lg">
          {image ? (
            <img src={image} alt={title} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
              🎁
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Подарок выбрали!</p>
            <p className="truncate text-xs text-muted-foreground">{title}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => confirm(() => toast.dismiss(t))}
              className="rounded-lg bg-mint px-2.5 py-1 text-[11px] font-semibold text-mint-foreground active:scale-95"
            >
              ✅ Передал
            </button>
            <button
              type="button"
              onClick={() => {
                toast.dismiss(t);
                navigate({ to: "/chat/$giftId", params: { giftId: tx.gift_id } });
              }}
              className="rounded-lg border px-2.5 py-1 text-[11px] font-medium active:scale-95"
            >
              💬 В чат
            </button>
          </div>
        </div>
      ),
      { duration: 20000 },
    );

    window.dispatchEvent(new CustomEvent("cozy:gifts-activity"));
  };

  // Догоняем то, что случилось, пока человека не было в сервисе — только
  // события ПОСЛЕ прошлого визита, не весь исторический хвост.
  useEffect(() => {
    if (!user?.user_id) return;
    let alive = true;
    (async () => {
      const since = readLastSeen();
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("transactions")
        .select("id, gift_id, gift:gifts(title, image_url)")
        .eq("sender_id", user.user_id)
        .eq("status", "pending")
        .is("handover_requested_at", null)
        .gt("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5);
      writeLastSeen(nowIso);
      if (!alive || !data) return;
      for (const row of data as Array<{
        id: string;
        gift_id: string;
        gift: { title: string; image_url: string | null } | null;
      }>) {
        showClaimedToast({ id: row.id, gift_id: row.gift_id }, row.gift?.title ?? "Подарок", row.gift?.image_url ?? null);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id]);

  // Подписка на брони в реальном времени, пока человек в приложении.
  useEffect(() => {
    if (!user?.user_id) return;
    const me = user.user_id;

    const txChannel = supabase
      .channel(`global-tx-${me}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transactions",
          filter: `sender_id=eq.${me}`,
        },
        async (payload) => {
          const tx = payload.new as { id: string; gift_id: string };
          const { data: gift } = await supabase
            .from("gifts")
            .select("title, image_url")
            .eq("id", tx.gift_id)
            .maybeSingle();
          showClaimedToast(tx, gift?.title ?? "Подарок", gift?.image_url ?? null);
          writeLastSeen(new Date().toISOString());
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(txChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id, navigate, requestHandoverFn]);

  return null;
}
