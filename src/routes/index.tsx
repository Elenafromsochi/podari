import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { DemoResetButton } from "@/components/DemoResetButton";
import { GiveGiftForm } from "@/components/GiveGiftForm";
import { ReceiveGiftFlow } from "@/components/ReceiveGiftFlow";
import { ChatScreen } from "@/components/ChatScreen";
import {
  loadState,
  saveState,
  addGift,
  type GameState,
  type GamePath,
} from "@/lib/game-state";

const ACTIVE_CHAT_KEY = "cozygift_active_chat_gift";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [state, setState] = useState<GameState | null>(null);
  const [activeChatGift, setActiveChatGift] = useState<string | null>(null);

  useEffect(() => {
    setState(loadState());
    if (typeof window !== "undefined") {
      setActiveChatGift(localStorage.getItem(ACTIVE_CHAT_KEY));
    }
  }, []);

  if (!state) return null;

  const update = (patch: Partial<GameState>) => {
    const next = { ...state, ...patch };
    setState(next);
    saveState(next);
  };

  const choose = (path: GamePath) =>
    update({ path, step: path === "give" ? "give_form" : "receive_categories" });

  const backToWelcome = () => update({ path: null, step: "welcome" });

  return (
    <div className="min-h-[100dvh] bg-background">
      <DemoResetButton />

      {state.step === "welcome" && <WelcomeScreen onChoose={choose} />}

      {state.step === "give_form" && (
        <GiveGiftForm
          onBack={backToWelcome}
          onDone={(giftId) => {
            addGift("posted", giftId);
            toast.success("+20 XP начислено ✨", {
              description: "Подарок опубликован",
            });
            update({ step: "give_done", xp: state.xp + 20 });
          }}
        />
      )}

      {state.step === "give_done" && (
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-5 py-10 text-center">
          <div className="text-5xl">🎉</div>
          <h2 className="text-2xl font-semibold">Подарок опубликован!</h2>
          <p className="rounded-xl bg-mint/40 px-4 py-3 text-sm text-foreground">
            +20 XP начислено ✨
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
            toast.success("Подарок выбран ✨", {
              description: "Открываем чат с дарителем",
            });
            update({ step: "chat" });
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
