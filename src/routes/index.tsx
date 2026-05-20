import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import {
  loadState,
  saveState,
  addGift,
  type GameState,
  type GamePath,
} from "@/lib/game-state";
import { loadUser, updateUser, type UserProfile } from "@/lib/auth-state";

const ACTIVE_CHAT_KEY = "cozygift_active_chat_gift";
const GIFT_COST = 100;

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
  const [state, setState] = useState<GameState | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeChatGift, setActiveChatGift] = useState<string | null>(null);
  const [givePresetHint, setGivePresetHint] = useState<string | null>(null);

  useEffect(() => {
    setState(loadState());
    setUser(loadUser());
    setAuthChecked(true);
    if (typeof window !== "undefined") {
      setActiveChatGift(localStorage.getItem(ACTIVE_CHAT_KEY));
    }
  }, []);

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
          onDone={(giftId) => {
            addGift("posted", giftId);
            burstConfetti();
            toast.success("+20 Опыта начислено ✨", {
              description: "Подарок размещён в игровом мире",
            });
            const u = updateUser({ xp_balance: (user?.xp_balance ?? 0) + 20 });
            if (u) setUser(u);
            update({ step: "give_done", xp: state.xp + 20 });
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
          onPick={(giftId) => {
            addGift("received", giftId);
            localStorage.setItem(ACTIVE_CHAT_KEY, giftId);
            setActiveChatGift(giftId);
            const newBalance = Math.max(0, (user?.l_points_balance ?? state.balance) - 100);
            const u = updateUser({ l_points_balance: newBalance });
            if (u) setUser(u);
            toast.success("−100 баллов заморожены • Безопасная сделка 🔒", {
              description: "Открываем чат с дарителем",
            });
            update({ step: "chat", balance: newBalance });
          }}
        />
      )}

      {(state.step === "chat" || state.step === "done") && (
        activeChatGift ? (
          <ChatScreen
            giftId={activeChatGift}
            onBack={() => {
              localStorage.removeItem(ACTIVE_CHAT_KEY);
              setActiveChatGift(null);
              backToWelcome();
            }}
            onHandover={() => {
              // Получатель подтвердил получение
              const fresh = loadState();
              const next = { ...fresh, xp: fresh.xp + 20 };
              saveState(next);
              setState(next);
              const u = updateUser({ xp_balance: (loadUser()?.xp_balance ?? 0) + 20 });
              if (u) setUser(u);
            }}
            onReview={() => {
              burstConfetti();
              toast.success("Спасибо за отзыв • +20 Опыта 💚");
              const fresh = loadState();
              const next = { ...fresh, xp: fresh.xp + 20, path: null, step: "welcome" as const };
              saveState(next);
              setState(next);
              const u = updateUser({ xp_balance: (loadUser()?.xp_balance ?? 0) + 20 });
              if (u) setUser(u);
              localStorage.removeItem(ACTIVE_CHAT_KEY);
              setActiveChatGift(null);
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
    </div>
  );
}
