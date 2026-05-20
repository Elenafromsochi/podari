interface Props {
  onPick: (chip: string) => void;
  onBack: () => void;
}

const CHIPS = [
  { id: "thing", label: "Вещь дома, которой не пользуешься", emoji: "📦" },
  { id: "service", label: "Своя услуга / экспертность", emoji: "💼" },
  { id: "coffee", label: "Угостить кофе", emoji: "☕️" },
  { id: "walk", label: "Пойти вместе на выставку или прогулку", emoji: "🌿" },
];

export function GiveGiftChips({ onPick, onBack }: Props) {
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
        Давай узнаем, чем ты готов поделиться. Не думай долго — выбери один из вариантов:
      </p>
      <div className="flex flex-col gap-3">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.label)}
            className="group flex items-center gap-3 rounded-2xl border bg-card px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-accent hover:shadow-md"
          >
            <span className="text-2xl">{c.emoji}</span>
            <span className="flex-1 text-sm font-medium">{c.label}</span>
            <span className="text-muted-foreground transition group-hover:translate-x-1">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
