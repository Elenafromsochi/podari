// Единый источник правды по уровням: пороги XP и помощники. Раньше пороги
// дублировались в AppHeader — теперь берём отсюда.

// XP, накопленный к началу каждого уровня. Индекс 0 — уровень 1 (0 XP),
// индекс 1 — уровень 2 (200 XP) и т.д.
export const LEVEL_THRESHOLDS = [0, 200, 500, 1000, 1700, 2500];

/** Сколько всего XP нужно, чтобы ДОСТИЧЬ уровня `level` (level считается с 1). */
export function xpForLevel(level: number): number {
  const i = Math.max(0, Math.min(LEVEL_THRESHOLDS.length - 1, level - 1));
  return LEVEL_THRESHOLDS[i];
}

/** Сколько XP осталось текущему пользователю до уровня `level`. */
export function xpRemainingToLevel(xp: number, level: number): number {
  return Math.max(0, xpForLevel(level) - xp);
}

/**
 * Требуемый уровень для получения подарка. И стоимость в баллах, и минимальный
 * уровень категории работают как порог: нужен уровень не ниже обоих.
 */
export function giftRequiredLevel(kindMinLevel: number | undefined, cost: number | undefined): number {
  return Math.max(kindMinLevel || 1, cost || 1);
}

// Способы поднять уровень — от самого быстрого/простого к остальным.
export const LEVEL_UP_WAYS: { emoji: string; label: string; xp: number; note: string }[] = [
  { emoji: "🤝", label: "Пригласить друга", xp: 50, note: "за каждого, кто зайдёт по ссылке — проще всего" },
  { emoji: "🎁", label: "Подарить подарок", xp: 80, note: "когда вручишь его" },
  { emoji: "✨", label: "Разместить подарок", xp: 20, note: "за каждую публикацию" },
  { emoji: "✍️", label: "Оставить отзыв", xp: 20, note: "после сделки" },
];
