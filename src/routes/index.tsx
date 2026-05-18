import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { DemoResetButton } from "@/components/DemoResetButton";
import { GiveGiftForm } from "@/components/GiveGiftForm";
import { loadState, saveState, type GameState, type GamePath } from "@/lib/game-state";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [state, setState] = useState<GameState | null>(null);

  useEffect(() => {
    setState(loadState());
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
          onDone={() => update({ step: "give_done", xp: state.xp + 20 })}
        />
      )}

      {state.step === "give_done" && (
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-center">
          <h2 className="text-2xl font-semibold">Подарок опубликован 🎉</h2>
          <p className="text-muted-foreground">
            +20 XP. Скоро кто-то его заметит. Следующий шаг откроется на следующем этапе.
          </p>
          <button
            onClick={backToWelcome}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            ← Вернуться к началу
          </button>
        </div>
      )}

      {state.step !== "welcome" &&
        state.step !== "give_form" &&
        state.step !== "give_done" && (
          <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-center">
            <h2 className="text-2xl font-semibold">Путь получателя ✨</h2>
            <p className="text-muted-foreground">
              Этот шаг появится на следующем этапе.
            </p>
            <button
              onClick={backToWelcome}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              ← Вернуться к началу
            </button>
          </div>
        )}
    </div>
  );
}
