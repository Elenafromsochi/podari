import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import {
  GIFT_KINDS,
  pickRandomHint,
  pickRandomSubtitle,
  type GiftKind,
} from "@/lib/gift-kinds";

interface Props {
  onPick: (kind: GiftKind, hint: string) => void;
  onBack: () => void;
  userLevel: number;
}

const UNLOCK_SEEN_KEY = "cozy_seen_all_unlocked";

export function GiveGiftChips({ onPick, onBack, userLevel }: Props) {
  // Меняющиеся подзаголовки фиксируются один раз на сессию открытия экрана.
  const subtitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const k of GIFT_KINDS) map[k.id] = pickRandomSubtitle(k.id);
    return map;
  }, []);

  const allUnlocked = GIFT_KINDS.every((k) => userLevel >= k.minLevel);

  // Показываем «все категории открыты» только один раз и больше не отвлекаем.
  const [showUnlockedNote, setShowUnlockedNote] = useState(false);
  useEffect(() => {
    if (!allUnlocked) return;
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem(UNLOCK_SEEN_KEY) === "1";
    if (!seen) {
      setShowUnlockedNote(true);
      localStorage.setItem(UNLOCK_SEEN_KEY, "1");
    }
  }, [allUnlocked]);

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
      <p className="mb-5 text-balance text-muted-foreground">
        {allUnlocked
          ? "Чем готов поделиться? Выбери категорию подарка."
          : `Чем готов поделиться? Категории открываются по уровню — твой сейчас: ⭐ ${userLevel}.`}
      </p>

      {showUnlockedNote && (
        <div className="mb-5 rounded-2xl bg-mint/30 px-4 py-3 text-sm text-foreground">
          🎉 Все категории подарков теперь открыты — выбирай любую.
        </div>
      )}

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
              className={`group flex items-start gap-3 rounded-2xl border bg-card px-4 py-4 text-left shadow-sm transition ${
                locked
                  ? "cursor-not-allowed opacity-60"
                  : "hover:-translate-y-0.5 hover:bg-accent hover:shadow-md"
              }`}
            >
              <span className="text-2xl leading-none">{c.emoji}</span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {locked ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Откроется на {c.minLevel} уровне
                    </span>
                  ) : (
                    subtitles[c.id]
                  )}
                </span>
              </span>
              <span className="mt-1 text-muted-foreground transition group-hover:translate-x-1">
                {locked ? <Lock className="h-4 w-4" /> : "→"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
