interface Props {
  onPick: (chip: string) => void;
  onBack: () => void;
}

const CHIPS: { id: string; label: string; emoji: string; hints: string[] }[] = [
  {
    id: "thing",
    label: "Вещь дома, которой не пользуешься",
    emoji: "📦",
    hints: [
      "Книга, которую прочитал и больше не вернусь к ней",
      "Настольная игра, что пылится на полке",
      "Красивая ваза, которая не вписалась в интерьер",
      "Беспроводные наушники, лежат без дела",
      "Новый блокнот, всё никак не начну вести",
      "Кофемолка, которой пользовался пару раз",
      "Свеча с любимым ароматом из дубля",
      "Виниловая пластинка, не подошла под мой плеер",
    ],
  },
  {
    id: "service",
    label: "Своя услуга / экспертность",
    emoji: "💼",
    hints: [
      "Часовая консультация по карьере и резюме",
      "Помогу собрать капсульный гардероб",
      "Разберу ваш сайт с точки зрения UX",
      "Проведу мини-сессию по тайм-менеджменту",
      "Сделаю фотопортрет за 30 минут",
      "Помогу с настройкой Notion под ваши задачи",
      "Урок английского — разговорная практика",
      "Дам обратную связь по вашему питчу",
    ],
  },
  {
    id: "coffee",
    label: "Угостить кофе",
    emoji: "☕️",
    hints: [
      "Флэт уайт в уютной кофейне у метро",
      "Раф на лавандовом сиропе с видом на парк",
      "Капучино и круассан на двоих утром",
      "Эспрессо и медленный разговор на час",
      "Матча-латте в новом спешелти на районе",
      "Фильтр-кофе с обжарщиком и историей зерна",
    ],
  },
  {
    id: "walk",
    label: "Пойти вместе на выставку или прогулку",
    emoji: "🌿",
    hints: [
      "Прогулка по набережной на закате",
      "Поход на выставку современного искусства",
      "Утренний забег в парке + завтрак после",
      "Экскурсия по архитектуре центра города",
      "Вечер в ботаническом саду",
      "Спокойная прогулка с разговорами по душам",
    ],
  },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

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
            onClick={() => onPick(pickRandom(c.hints))}
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
