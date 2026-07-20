import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { requestHandover } from "@/lib/cozy.functions";

/**
 * Глобальный слушатель Realtime: когда чужой подарок выбирают ПРЯМО СЕЙЧАС
 * (пока человек в приложении), показываем лёгкий тост сверху — не модалку.
 * Только для новых событий в реальном времени: копившийся раньше «хвост»
 * неподтверждённых броней тостами не показываем — не должны настигать
 * повторно за уже виденные чаты. Разобрать старые брони можно в профиле
 * («Забронировали у вас»), это не push, а pull — по желанию, без нажима.
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
          const title = gift?.title ?? "Подарок";
          const image = gift?.image_url ?? null;

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

          // увеличим счётчик «новых событий по подаркам» для бейджа в кабинете
          window.dispatchEvent(new CustomEvent("cozy:gifts-activity"));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(txChannel);
    };
  }, [user?.user_id, navigate, requestHandoverFn]);

  return null;
}
