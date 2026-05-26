// Лёгкий тактильный отклик — работает на устройствах с Vibration API
// (мобильный Chrome/Android; iOS Safari игнорирует, но не падает).
type HapticKind = "light" | "medium" | "success" | "warning" | "select";

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 16,
  select: 5,
  success: [10, 40, 18],
  warning: [20, 60, 20],
};

export function haptic(kind: HapticKind = "light") {
  if (typeof navigator === "undefined") return;
  const v = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate;
  if (!v) return;
  try {
    v.call(navigator, PATTERNS[kind]);
  } catch {
    /* noop */
  }
}
