import { Gift, HandHeart, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GamePath } from "@/lib/game-state";

interface Props {
  onChoose: (path: GamePath) => void;
}

export function WelcomeScreen({ onChoose }: Props) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-8 px-5 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-peach shadow-sm">
          <Sparkles className="h-10 w-10 text-peach-foreground" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Привет 👋</h1>
        <p className="text-balance text-muted-foreground">
          Это уютное место, где люди дарят друг другу время, вещи и заботу.
          С чего начнём твоё приключение?
        </p>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Button
          onClick={() => onChoose("receive")}
          className="h-auto justify-start gap-4 rounded-2xl bg-mint px-5 py-5 text-mint-foreground shadow-sm hover:bg-mint/90"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background/60">
            <Gift className="h-5 w-5" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-base font-semibold">Получить подарок</span>
            <span className="text-xs opacity-80">Найди что-то приятное рядом</span>
          </div>
        </Button>

        <Button
          onClick={() => onChoose("give")}
          className="h-auto justify-start gap-4 rounded-2xl bg-lavender px-5 py-5 text-lavender-foreground shadow-sm hover:bg-lavender/90"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background/60">
            <HandHeart className="h-5 w-5" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-base font-semibold">Подарить подарок</span>
            <span className="text-xs opacity-80">Поделись тем, что больше не нужно</span>
          </div>
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        +100 баллов уже на твоём балансе ✨
      </p>
    </div>
  );
}
