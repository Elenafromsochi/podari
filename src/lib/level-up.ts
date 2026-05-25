// Детектор перехода на новый уровень.
// Хранит последний известный уровень в localStorage и при изменении
// диспатчит window-событие cozy:level-up { level }, на которое подписан LevelUpModal.

const KEY = "cozygift_last_known_level";

export function checkLevelUp(newLevel: number) {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem(KEY);
  const prev = raw ? parseInt(raw, 10) : null;
  // Первый известный уровень — просто запоминаем, без модалки
  if (prev === null) {
    localStorage.setItem(KEY, String(newLevel));
    return;
  }
  if (newLevel > prev) {
    localStorage.setItem(KEY, String(newLevel));
    window.dispatchEvent(new CustomEvent("cozy:level-up", { detail: { level: newLevel } }));
  } else if (newLevel !== prev) {
    localStorage.setItem(KEY, String(newLevel));
  }
}

export function resetLevelTracking() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
