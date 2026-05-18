import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { DemoResetButton } from "@/components/DemoResetButton";
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

  const choose = (path: GamePath) => {
    const next: GameState = {
      ...state,
      path,
      step: path === "give" ? "give_form" : "receive_categories",
    };
    setState(next);
    saveState(next);
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <DemoResetButton />
      {state.step === "welcome" && <WelcomeScreen onChoose={choose} />}

      {state.step !== "welcome" && (
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-center">
          <h2 className="text-2xl font-semibold">
            {state.path === "give" ? "Путь дарителя 🎁" : "Путь получателя ✨"}
          </h2>
          <p className="text-muted-foreground">
            Этот шаг появится на следующем этапе. Сейчас активна развилка из Шага 1.
          </p>
          <button
            onClick={() => {
              const next: GameState = { ...state, path: null, step: "welcome" };
              setState(next);
              saveState(next);
            }}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            ← Вернуться к началу
          </button>
        </div>
      )}
    </div>
  );
}
