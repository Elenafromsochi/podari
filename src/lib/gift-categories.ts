// Стандартные категории подарков. Используются и при автогенерации
// названия/категории через AI, и при группировке в ленте выбора.
export const STANDARD_CATEGORIES: Array<{ id: string; emoji: string; label: string }> = [
  { id: "одежда",      emoji: "👕", label: "Одежда и аксессуары" },
  { id: "книги",       emoji: "📚", label: "Книги" },
  { id: "электроника", emoji: "🎧", label: "Электроника" },
  { id: "дом",         emoji: "🏡", label: "Дом и уют" },
  { id: "красота",     emoji: "💄", label: "Красота и уход" },
  { id: "спорт",       emoji: "🏀", label: "Спорт и активность" },
  { id: "игрушки",     emoji: "🧸", label: "Игрушки и хобби" },
  { id: "еда",         emoji: "🍫", label: "Еда" },
  { id: "напитки",     emoji: "☕", label: "Напитки" },
  { id: "музыка",      emoji: "🎵", label: "Музыка" },
  { id: "путешествия", emoji: "✈️", label: "Путешествия" },
  { id: "медитации",   emoji: "🧘", label: "Медитации и практики" },
  { id: "разное",      emoji: "🎁", label: "Разное" },
];

export const CATEGORY_IDS = STANDARD_CATEGORIES.map((c) => c.id);

export function getCategoryMeta(id: string) {
  return (
    STANDARD_CATEGORIES.find((c) => c.id === id.toLowerCase()) ??
    { id, emoji: "🎁", label: id }
  );
}
