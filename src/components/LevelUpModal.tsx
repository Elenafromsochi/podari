import { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import level2Img from "@/assets/level-2-services.jpg";
import level3Img from "@/assets/level-3-events.jpg";

type LevelMeta = {
  emoji: string;
  title: string;
  subtitle: string;
  unlocks: string;
  image?: string;
  imageAlt?: string;
  accent: string; // tailwind bg-* class
};

const LEVELS: Record<number, LevelMeta> = {
  2: {
    emoji: "🤝",
    title: "Найди друзей — открыто!",
    subtitle: "Знакомства и встречи вживую",
    unlocks:
      "Зови на кофе, прогулку, футбол или общее хобби — провести время в хорошей компании. Дружеские знакомства, не только романтические.",
    image: level2Img,
    imageAlt: "Двое за кофе",
    accent: "bg-mint",
  },
  3: {
    emoji: "🎟",
    title: "Мероприятия — открыто!",
    subtitle: "Пригласи на событие или прими приглашение",
    unlocks:
      "Выставка, концерт, театр, лекция, танцы, кино — позови кого-то разделить вечер вдвоём или сам прими приглашение.",
    image: level3Img,
    imageAlt: "Сцена и зрители",
    accent: "bg-lavender",
  },
  4: {
    emoji: "🏅",
    title: "4 уровень — Надёжный даритель!",
    subtitle: "Сообщество тебе доверяет",
    unlocks:
      "Твой профиль отмечен значком доверия — тебе охотнее дарят и принимают подарки.",
    accent: "bg-peach",
  },
  5: {
    emoji: "👑",
    title: "5 уровень — Хранитель тепла!",
    subtitle: "Высшее признание сообщества",
    unlocks: "Спасибо, что несёшь добро. Особый статус и почёт в «Подари» 💚",
    accent: "bg-lavender",
  },
};

function fireConfetti() {
  const opts = { spread: 90, ticks: 220, gravity: 0.85, scalar: 1.1 } as const;
  confetti({ ...opts, particleCount: 100, origin: { x: 0.15, y: 0.55 } });
  confetti({ ...opts, particleCount: 100, origin: { x: 0.85, y: 0.55 } });
  setTimeout(
    () => confetti({ ...opts, particleCount: 140, origin: { x: 0.5, y: 0.3 } }),
    220,
  );
}

export function LevelUpModal() {
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    const onLevelUp = (e: Event) => {
      const detail = (e as CustomEvent<{ level: number }>).detail;
      if (!detail?.level) return;
      setLevel(detail.level);
      // Небольшая задержка чтобы модалка успела появиться
      setTimeout(fireConfetti, 150);
    };
    window.addEventListener("cozy:level-up", onLevelUp);
    return () => window.removeEventListener("cozy:level-up", onLevelUp);
  }, []);

  if (level === null) return null;
  const meta = LEVELS[level] ?? {
    emoji: "🌟",
    title: `${level} уровень открыт!`,
    subtitle: "Ты растёшь — спасибо, что делишься теплом",
    unlocks: "Продолжай дарить и получать — впереди ещё больше возможностей.",
    accent: "bg-mint",
  };

  return (
    <Dialog open onOpenChange={(open) => !open && setLevel(null)}>
      <DialogContent className="max-w-sm overflow-hidden rounded-3xl border-0 p-0">
        <div className={`${meta.accent} px-6 pt-7 pb-6 text-center animate-fade-in`}>
          <p className="text-[12.5px] font-semibold uppercase tracking-wide opacity-80">
            🎉 Поздравляю! Ты перешёл на {level} уровень
          </p>
          <div className="mb-3 mt-2 text-5xl animate-scale-in">{meta.emoji}</div>
          <h2 className="text-2xl font-semibold tracking-tight">{meta.title}</h2>
          <p className="mt-1 text-sm opacity-80">{meta.subtitle}</p>
        </div>

        {meta.image && (
          <div className="px-6 pt-4">
            <img
              src={meta.image}
              alt={meta.imageAlt ?? meta.title}
              width={768}
              height={768}
              loading="lazy"
              className="mx-auto h-44 w-44 rounded-2xl object-cover shadow-sm animate-scale-in"
            />
          </div>
        )}

        <div className="space-y-4 px-6 pb-6 pt-4 text-center">
          <p className="text-balance text-sm text-muted-foreground">{meta.unlocks}</p>
          <Button
            onClick={() => setLevel(null)}
            className="w-full rounded-2xl bg-primary py-5 text-base font-semibold"
          >
            Здорово!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
