import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { DemoResetButton } from "@/components/DemoResetButton";
import { GiveGiftChips } from "@/components/GiveGiftChips";
import { GiveGiftForm } from "@/components/GiveGiftForm";
import { ReceiveGiftFlow } from "@/components/ReceiveGiftFlow";
import { ChatScreen } from "@/components/ChatScreen";
import { AuthFlow } from "@/components/AuthFlow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadState, saveState, type GameState, type GamePath } from "@/lib/game-state";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { claimGift } from "@/lib/cozy.functions";
import { supabase } from "@/integrations/supabase/client";

const ACTIVE_CHAT_KEY = "cozygift_active_chat_gift";
const ACTIVE_TX_KEY = "cozygift_active_tx";

export const Route = createFileRoute("/")({
  component: Index,
});

const burstConfetti = () => {
  const opts = { spread: 80, ticks: 200, gravity: 0.9, scalar: 1.1 } as const;
  confetti({ ...opts, particleCount: 80, origin: { x: 0.2, y: 0.7 } });
  confetti({ ...opts, particleCount: 80, origin: { x: 0.8, y: 0.7 } });
  setTimeout(
    () => confetti({ ...opts, particleCount: 120, origin: { x: 0.5, y: 0.4 } }),
    250,
  );
};

function Index() {
  const navigate = useNavigate();
  const [state, setState] = useState<GameState | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeChatGift, setActiveChatGift] = useState<string | null>(null);
  const [activeTxId, setActiveTxId] = useState<string | null>(null);
  const [givePresetHint, setGivePresetHint] = useState<string | null>(null);
  const [insufficientOpen, setInsufficientOpen] = useState(false);

  const claim = useServerFn(claimGift);

  const refreshUser = async () => {
    const u = await loadUser();
    setUser(u);
    return u;
  };

  useEffect(() => {
    let mounted = true;
    setState(loadState());
    (async () => {
      const u = await loadUser();
      if (!mounted) return;
      setUser(u);
      setAuthChecked(true);
    })();
    if (typeof window !== "undefined") {
      setActiveChatGift(localStorage.getItem(ACTIVE_CHAT_KEY));
      setActiveTxId(localStorage.getItem(ACTIVE_TX_KEY));
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setUser(null);
      } else {
        loadUser().then(setUser);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Уведомление дарителю: кто-то забрал его подарок
  useEffect(() => {
    if (!user?.user_id) return;
    const channel = supabase
      .channel(`tx-for-${user.user_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transactions",
          filter: `sender_id=eq.${user.user_id}`,
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
              onClick: () => {
                navigate({ to: "/chat/$giftId", params: { giftId: tx.gift_id } });
              },
            },
            duration: 12000,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id]);

  if (!authChecked || !state) return null;

  if (!user) {
    return (
      <AuthFlow
        onAuthed={(u) => {
          setUser(u);
        }}
      />
    );
  }

  const update = (patch: Partial<GameState>) => {
    const fresh = loadState();
    const next = { ...fresh, ...patch };
    setState(next);
    saveState(next);
  };

  const choose = (path: GamePath) =>
    update({ path, step: path === "give" ? "give_chip" : "receive_categories" });

  const backToWelcome = () => update({ path: null, step: "welcome" });

  return (
    <div className="min-h-[100dvh] bg-background">
      <DemoResetButton />

      {state.step === "welcome" && <WelcomeScreen onChoose={choose} />}

      {state.step === "give_chip" && (
        <GiveGiftChips
          onBack={backToWelcome}
          onPick={(label) => {
            setGivePresetHint(label);
            update({ step: "give_form" });
          }}
        />
      )}

      {state.step === "give_form" && (
        <GiveGiftForm
          onBack={() => update({ step: "give_chip" })}
          presetHint={givePresetHint}
          onDone={async () => {
            burstConfetti();
            toast.success("+20 Опыта начислено ✨", {
              description: "Подарок размещён в игровом мире",
            });
            await refreshUser();
            update({ step: "give_done" });
          }}
        />
      )}

      {state.step === "give_done" && (
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-5 py-10 text-center">
          <div className="text-5xl">🎉</div>
          <h2 className="text-2xl font-semibold">Подарок размещён!</h2>
          <p className="rounded-xl bg-mint/40 px-4 py-3 text-sm text-foreground">
            +20 Опыта начислено ✨
          </p>
          <p className="text-balance text-muted-foreground">
            Для равновесия системы — выбери себе подарок. Дарить и получать одинаково важно 💚
          </p>
          <button
            onClick={() => update({ path: "receive", step: "receive_categories" })}
            className="mt-2 w-full rounded-2xl bg-mint px-5 py-4 text-base font-semibold text-mint-foreground shadow-sm transition hover:bg-mint/90"
          >
            🎁 Получить подарок
          </button>
          <button
            onClick={() => update({ path: "give", step: "give_chip" })}
            className="w-full rounded-2xl border border-mint/60 bg-background px-5 py-4 text-base font-semibold text-foreground transition hover:bg-mint/10"
          >
            ➕ Разместить ещё подарок
          </button>
          <button
            onClick={backToWelcome}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Вернуться к началу
          </button>
        </div>
      )}

      {(state.step === "receive_categories" || state.step === "receive_feed") && (
        <ReceiveGiftFlow
          onBack={backToWelcome}
          onPick={async (giftId) => {
            try {
              const res = await claim({ data: { gift_id: giftId } });
              localStorage.setItem(ACTIVE_CHAT_KEY, giftId);
              localStorage.setItem(ACTIVE_TX_KEY, res.transaction_id);
              setActiveChatGift(giftId);
              setActiveTxId(res.transaction_id);
              await refreshUser();
              toast.success("−100 баллов заморожены • Безопасная сделка 🔒", {
                description: "Открываем чат с дарителем",
              });
              update({ step: "chat" });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (msg.includes("INSUFFICIENT_BALANCE")) {
                setInsufficientOpen(true);
              } else if (msg.includes("ALREADY_TAKEN")) {
                toast.error("Подарок уже забрали", { description: "Выбери другой 💚" });
              } else if (msg.includes("OWN_GIFT")) {
                toast.error("Это твой подарок", {
                  description: "Своё забрать нельзя — выбери чужой 🙂",
                });
              } else {
                toast.error("Не получилось забрать подарок", { description: msg });
              }
            }
          }}
        />
      )}

      {(state.step === "chat" || state.step === "done") && (
        activeChatGift && activeTxId ? (
          <ChatScreen
            giftId={activeChatGift}
            transactionId={activeTxId}
            onBack={() => {
              localStorage.removeItem(ACTIVE_CHAT_KEY);
              localStorage.removeItem(ACTIVE_TX_KEY);
              setActiveChatGift(null);
              setActiveTxId(null);
              backToWelcome();
            }}
            onHandover={async () => {
              await refreshUser();
            }}
            onReview={async () => {
              burstConfetti();
              toast.success("Спасибо за отзыв • +20 Опыта 💚");
              await refreshUser();
              localStorage.removeItem(ACTIVE_CHAT_KEY);
              localStorage.removeItem(ACTIVE_TX_KEY);
              setActiveChatGift(null);
              setActiveTxId(null);
              backToWelcome();
            }}
          />
        ) : (
          <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-center">
            <p className="text-muted-foreground">Нет активного чата</p>
            <button
              onClick={backToWelcome}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              ← Вернуться к началу
            </button>
          </div>
        )
      )}

      <Dialog open={insufficientOpen} onOpenChange={setInsufficientOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Недостаточно подарочных баллов 🎁</DialogTitle>
            <DialogDescription className="pt-2 text-left">
              Чтобы выбрать новый подарок, нужно <b>100 баллов</b>. Сейчас твои баллы заморожены или потрачены.
              <br /><br />
              Размести свой подарок и дождись, когда кто-то его заберёт — тебе вернётся <b>+100 баллов</b>, и ты снова сможешь получать подарки. Дарить и получать — одинаково важно 💚
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <button
              onClick={() => {
                setInsufficientOpen(false);
                update({ path: "give", step: "give_chip" });
              }}
              className="w-full rounded-2xl bg-mint px-5 py-3 text-base font-semibold text-mint-foreground transition hover:bg-mint/90"
            >
              ➕ Разместить подарок
            </button>
            <button
              onClick={() => setInsufficientOpen(false)}
              className="w-full rounded-2xl border px-5 py-3 text-sm text-muted-foreground transition hover:bg-accent"
            >
              Понятно
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
