import { Lock } from "lucide-react";
import { toast } from "sonner";
import { GIFT_KINDS, pickRandomHint, type GiftKind } from "@/lib/gift-kinds";

interface Props {
  onPick: (kind: GiftKind, hint: string) => void;
  onBack: () => void;
  userLevel: number;
}

export function GiveGiftChips({ onPick, onBack, userLevel }: Props) {
  const handleLocked = (minLevel: number, label: string) => {
    toast(`🔒 ${label}`, {
      description: `Откроется на ${minLevel} уровне. Продолжай дарить и получать — и ты дойдёшь сюда!`,
    });
  };

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <button
        onClick={onBack}
        className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Назад
      </button>
      <h2 className="mb-2 text-2xl font-semibold tracking-tight">Отличный выбор! ✨</h2>
      <p className="mb-6 text-balance text-muted-foreground">
        Чем готов поделиться? Категории открываются по мере роста уровня — твой сейчас: <b>{userLevel}</b>.
      </p>
      <div className="flex flex-col gap-3">
        {GIFT_KINDS.map((c) => {
          const locked = userLevel < c.minLevel;
          return (
            <button
              key={c.id}
              onClick={() =>
                locked
                  ? handleLocked(c.minLevel, c.label)
                  : onPick(c.id, pickRandomHint(c.id))
              }
              aria-disabled={locked}
              className={`group flex items-center gap-3 rounded-2xl border bg-card px-4 py-4 text-left shadow-sm transition ${
                locked
                  ? "cursor-not-allowed opacity-60"
                  : "hover:-translate-y-0.5 hover:bg-accent hover:shadow-md"
              }`}
            >
              <span className="text-2xl">{c.emoji}</span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{c.label}</span>
                {locked && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" /> Откроется на {c.minLevel} уровне
                  </span>
                )}
              </span>
              <span className="text-muted-foreground transition group-hover:translate-x-1">
                {locked ? <Lock className="h-4 w-4" /> : "→"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
