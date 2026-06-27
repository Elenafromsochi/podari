import { HandHeart, Sparkles } from "lucide-react";
import { haptic } from "@/lib/haptics";

interface Props {
  /** Подарить своё — то, что у тебя есть (обычная ветка). */
  onPickOwn: () => void;
  /** Подарить то, что хотят другие — исполнить чужое желание. */
  onPickWish: () => void;
  onBack: () => void;
}

/**
 * Развилка после кнопки «Подарить»: два пути — отдать что-то своё или
 * исполнить чьё-то желание. «Своё» ведёт по обычной ветке (выбор категории),
 * «что хотят другие» — на ленту желаний.
 */
export function GiveChoice({ onPickOwn, onPickWish, onBack }: Props) {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <button
        onClick={onBack}
        className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Назад
      </button>
      <h2 className="mb-2 text-2xl font-semibold tracking-tight">Что подарим? 💚</h2>
      <p className="mb-5 text-balance text-muted-foreground">
        Можно отдать что-то своё или исполнить чьё-то желание — выбирай.
      </p>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            onPickOwn();
          }}
          className="group flex items-start gap-3 rounded-2xl bg-lavender px-4 py-4 text-left text-lavender-foreground shadow-sm transition active:scale-[0.98] hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
            <HandHeart className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block text-[15px] font-semibold leading-tight">Подарить своё</span>
            <span className="mt-0.5 block text-xs opacity-75">
              Отдай то, что у тебя есть и кому-то пригодится
            </span>
          </span>
          <span className="mt-1 transition group-hover:translate-x-1">→</span>
        </button>

        <button
          type="button"
          onClick={() => {
            haptic("medium");
            onPickWish();
          }}
          className="group flex items-start gap-3 rounded-2xl bg-mint px-4 py-4 text-left text-mint-foreground shadow-sm transition active:scale-[0.98] hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block text-[15px] font-semibold leading-tight">
              Подарить то, что хотят другие
            </span>
            <span className="mt-0.5 block text-xs opacity-75">
              Исполни чьё-то желание из ленты
            </span>
          </span>
          <span className="mt-1 transition group-hover:translate-x-1">→</span>
        </button>
      </div>
    </div>
  );
}
