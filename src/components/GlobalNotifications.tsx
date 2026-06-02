import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadUser, type UserProfile } from "@/lib/auth-state";

/**
 * Глобальный слушатель Realtime для:
 *  - уведомлений дарителю, что его подарок выбрали (новая транзакция);
 *  - уведомлений о новых сообщениях в чатах (от другого участника).
 * Монтируется один раз в __root.tsx и работает на любом маршруте.
 */
export function GlobalNotifications() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);

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
            .select("title")
            .eq("id", tx.gift_id)
            .maybeSingle();
          toast.success("Твой подарок выбрали! 💚", {
            description: `«${gift?.title ?? "Подарок"}» — открой чат с получателем`,
            action: {
              label: "В чат",
              onClick: () => navigate({ to: "/chat/$giftId", params: { giftId: tx.gift_id } }),
            },
            duration: 12000,
          });
          // увеличим счётчик «новых событий по подаркам» для бейджа в кабинете
          window.dispatchEvent(new CustomEvent("cozy:gifts-activity"));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(txChannel);
    };
  }, [user?.user_id, navigate]);

  return null;
}
