// Локальный UX-стейт онбординга. Бизнес-данные (баланс, опыт, уровень,
// история подарков) хранятся в базе и читаются через server functions.
const KEY = "cozygift_game_state_v1";

export type GamePath = "give" | "receive" | null;
export type GameStep =
  | "welcome"
  | "give_chip"
  | "give_form"
  | "give_done"
  | "receive_categories"
  | "receive_feed"
  | "chat"
  | "done";

export interface GameState {
  path: GamePath;
  step: GameStep;
}

export const initialState: GameState = {
  path: null,
  step: "welcome",
};

export function loadState(): GameState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState;
    return { ...initialState, ...JSON.parse(raw) };
  } catch {
    return initialState;
  }
}

export function saveState(s: GameState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function resetState() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
