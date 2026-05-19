// Локальное состояние игры (онбординг). Этап 1.
const KEY = "cozygift_game_state_v1";

export type GamePath = "give" | "receive" | null;
export type GameStep =
  | "welcome"
  | "give_form"
  | "give_done"
  | "receive_categories"
  | "receive_feed"
  | "chat"
  | "done";

export interface GameState {
  path: GamePath;
  step: GameStep;
  balance: number;
  xp: number;
  level: number;
  giftsPosted: string[];
  giftsGifted: string[];
  giftsReceived: string[];
}

export const initialState: GameState = {
  path: null,
  step: "welcome",
  balance: 100,
  xp: 0,
  level: 1,
  giftsPosted: [],
  giftsGifted: [],
  giftsReceived: [],
};

export function addGift(kind: "posted" | "gifted" | "received", id: string) {
  const s = loadState();
  const key =
    kind === "posted" ? "giftsPosted" : kind === "gifted" ? "giftsGifted" : "giftsReceived";
  const list = s[key] ?? [];
  if (!list.includes(id)) {
    saveState({ ...s, [key]: [...list, id] });
  }
}

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
