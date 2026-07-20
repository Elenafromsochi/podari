import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { requestHandover } from "@/lib/cozy.functions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type PendingHandover = { txId: string; giftId: string; title: string; image: string | null };

/**
 * Глобальный слушатель Realtime: когда чужой подарок выбирают, дарителю
 * на ЛЮБОЙ странице показывается окно с подтверждением передачи — не
 * тост, который можно пропустить. Монтируется один раз в __root.tsx.
 */
export function GlobalNotifications() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  // Подарки, которые у меня забронировали и я ещё не отметил(а) передачу —
  // окно с подтверждением висит на ЛЮБОЙ странице, пока не подтвердишь.
  const [pending, setPending] = useState<PendingHandover[]>([]);
  const requestHandoverFn = useServerFn(requestHandover);
  const [confirming, setConfirming] = useState(false);

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

  // При входе подтягиваем уже накопившиеся брони без подтверждения передачи —
  // например, подарок выбрали, пока человек не заходил в приложение.
  useEffect(() => {
    if (!user?.user_id) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, gift_id, gift:gifts(title, image_url)")
        .eq("sender_id", user.user_id)
        .eq("status", "pending")
        .is("handover_requested_at", null)
        .order("created_at", { ascending: true });
      if (!alive || !data) return;
      setPending(
        (
          data as Array<{
            id: string;
            gift_id: string;
            gift: { title: string; image_url: string | null } | null;
          }>
        ).map((row) => ({
          txId: row.id,
          giftId: row.gift_id,
          title: row.gift?.title ?? "Подарок",
          image: row.gift?.image_url ?? null,
        })),
      );
    })();
    return () => {
      alive = false;
    };
  }, [user?.user_id]);

  // Подписки на realtime-события
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
          // Окно с подтверждением передачи появится на любой странице —
          // отдельный тост тут больше не нужен, чтобы не дублировать.
          setPending((prev) =>
            prev.some((p) => p.txId === tx.id)
              ? prev
              : [
                  ...prev,
                  {
                    txId: tx.id,
                    giftId: tx.gift_id,
                    title: gift?.title ?? "Подарок",
                    image: gift?.image_url ?? null,
                  },
                ],
          );
          // увеличим счётчик «новых событий по подаркам» для бейджа в кабинете
          window.dispatchEvent(new CustomEvent("cozy:gifts-activity"));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "transactions",
          filter: `sender_id=eq.${me}`,
        },
        (payload) => {
          const tx = payload.new as { id: string; status: string; handover_requested_at: string | null };
          // Передачу отметили (или сделку отменили) — окно больше не нужно.
          if (tx.handover_requested_at || tx.status !== "pending") {
            setPending((prev) => prev.filter((p) => p.txId !== tx.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(txChannel);
    };
  }, [user?.user_id]);

  const current = pending[0] ?? null;

  const confirmHandover = async () => {
    if (!current) return;
    setConfirming(true);
    try {
      await requestHandoverFn({ data: { transaction_id: current.txId } });
      toast.success("Передача отмечена 💚", {
        description: "Получатель подтвердит — и сделка завершится",
      });
      setPending((prev) => prev.filter((p) => p.txId !== current.txId));
      window.dispatchEvent(new CustomEvent("cozy:chats-changed"));
    } catch (e) {
      toast.error("Не удалось подтвердить", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConfirming(false);
    }
  };

  const goToChat = () => {
    if (!current) return;
    const giftId = current.giftId;
    setPending((prev) => prev.filter((p) => p.txId !== current.txId));
    navigate({ to: "/chat/$giftId", params: { giftId } });
  };

  return (
    <AlertDialog open={!!current} onOpenChange={() => {}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Подарок выбрали! 🎁</AlertDialogTitle>
          <AlertDialogDescription>
            Когда передашь подарок — подтверди здесь, и сделка сможет завершиться.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {current && (
          <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
            {current.image ? (
              <img
                src={current.image}
                alt={current.title}
                className="h-14 w-14 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl">
                🎁
              </div>
            )}
            <span className="min-w-0 truncate text-sm font-semibold">{current.title}</span>
          </div>
        )}
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction onClick={confirmHandover} disabled={confirming} className="w-full">
            {confirming ? "Минутку…" : "✅ Подтвердить передачу"}
          </AlertDialogAction>
          <Button variant="outline" className="w-full" onClick={goToChat}>
            💬 Перейти в чат
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
