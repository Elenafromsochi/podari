// Лёгкий движок гида по сервису. Прогресс сохраняется per-user и
// автоматически возобновляется при перезагрузке. Все компоненты
// взаимодействуют через window-события — никаких импортов из глобального
// React-стейта не требуется.

import { useEffect, useState } from "react";

const KEY = "cozygift_tour_v2";

export type TourState = {
  userId: string | null;
  step: string | null;
  done: boolean;
};

const empty: TourState = { userId: null, step: null, done: false };

function read(): TourState {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty;
    const v = JSON.parse(raw) as Partial<TourState>;
    return { userId: v.userId ?? null, step: v.step ?? null, done: !!v.done };
  } catch {
    return empty;
  }
}

function write(s: TourState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("cozy:tour-state"));
}

export function useTourState(): TourState {
  const [s, setS] = useState<TourState>(() => read());
  useEffect(() => {
    const h = () => setS(read());
    window.addEventListener("cozy:tour-state", h);
    return () => window.removeEventListener("cozy:tour-state", h);
  }, []);
  return s;
}

/** Одноразовый снимок состояния гида (для решения «спросить ли продолжение»). */
export function getTourSnapshot(): TourState {
  return read();
}

/** Идёт ли сейчас гид (есть активный шаг и он не завершён). */
export function isTourActive(): boolean {
  const s = read();
  return !!s.step && !s.done;
}

/** Запускаем гид после авторизации. Существующим активным пользователям
 *  (с накопленным опытом) гид не показываем. */
export function startTourForUser(userId: string, xp: number, isNew: boolean) {
  const cur = read();
  if (cur.userId === userId) {
    if (cur.done) return;
    if (!cur.step) write({ userId, step: TOUR_STEPS[0].id, done: false });
    return;
  }
  // другой пользователь
  if (!isNew && xp > 0) {
    write({ userId, step: null, done: true });
    return;
  }
  write({ userId, step: TOUR_STEPS[0].id, done: false });
}

export function setTourStep(step: string | null) {
  const cur = read();
  write({ ...cur, step });
}

export function completeTour() {
  const cur = read();
  write({ ...cur, step: null, done: true });
}

/** Перезапуск гида с первого шага — для кнопки «Гид» в шапке.
 *  Позволяет пройти обучение снова, даже если его пропустили. */
export function restartTour() {
  const cur = read();
  write({ userId: cur.userId, step: TOUR_STEPS[0].id, done: false });
}

export function emitTour(event: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cozy:tour-event", { detail: event }));
}

// =====================================================================
// Сценарий гида
// =====================================================================

export type TourStep = {
  id: string;
  /** CSS-селектор подсвечиваемого элемента */
  target?: string;
  text: string;
  /** Подпись на кнопке. Если не указано — кнопка не показывается, гид ждёт advanceOn */
  cta?: string;
  /** Имя события (emitTour) для автоматического перехода */
  advanceOn?: string;
  /** Запустить конфетти при показе */
  confetti?: boolean;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "auth-confetti",
    text:
      "У тебя есть 1 подарочный балл — значит, ты можешь выбрать любой подарок, оценённый в 1 балл.",
    cta: "Как выбрать подарок?",
    confetti: true,
  },
  {
    id: "point-receive",
    target: '[data-tour="receive-btn"]',
    text: "Нажми сюда 👆",
    advanceOn: "receive-opened",
  },
  {
    id: "kinds-explain",
    target: '[data-tour="tour-spot"]',
    text:
      "На 1 уровне тебе доступны категории «Вещи» и «Услуги и время» — выбери что-нибудь.",
    advanceOn: "kind-picked",
  },
  {
    id: "subcat-explain",
    target: '[data-tour="tour-spot"]',
    text: "И здесь сделай выбор 🙂",
    advanceOn: "subcat-picked",
  },
  {
    id: "feed-explain",
    target: '[data-tour="tour-spot"]',
    text: "Ты добрался до настоящих сокровищ — выбирай любое!",
    advanceOn: "chat-opened",
  },
  {
    id: "chat-freeze",
    text:
      "Ты попал в чат с Дарителем — и в этот момент у тебя «заморозился» подарочный балл 🔒",
    cta: "Далее",
  },
  {
    id: "chat-templates",
    target: '[data-tour="chat-templates"]',
    text:
      "Ты можешь отправить шаблонное сообщение, нажав на кнопку, либо написать свой вопрос дарителю.",
    cta: "Написал(а)",
  },
  {
    id: "chat-decline",
    target: '[data-tour="chat-decline"]',
    text:
      "В любой момент, когда захочешь, можешь отказаться от подарка — просто нажми эту кнопку, и балл вернётся на баланс.",
    cta: "Далее",
  },
  {
    id: "point-nav",
    target: '[data-tour="tab-home"]',
    text:
      "Пока ждёшь ответа — выйдем из чата. Внизу — переходы между разделами, нажми «Главная» 🏠",
    advanceOn: "home-opened",
  },
  {
    id: "give-start",
    target: '[data-tour="give-btn"]',
    text:
      "А теперь давай сам что-нибудь подаришь — это пополняет баланс и поднимает уровень. Нажми «Подарить» 🎁",
    advanceOn: "give-opened",
  },
  {
    id: "give-kind",
    target: '[data-tour="give-kinds"]',
    text:
      "Выбери, чем хочешь поделиться — категории зависят от твоего уровня. Нажми на любую открытую.",
    advanceOn: "give-kind-picked",
  },
  {
    id: "give-photo",
    target: '[data-tour="give-photo"]',
    text:
      "Добавь фото — и ИИ сам опишет подарок и оценит состояние. Описание всегда можно поправить вручную.",
    cta: "Далее",
  },
  {
    id: "give-cost",
    target: '[data-tour="give-cost"]',
    text:
      "Теперь выбери, во сколько баллов оценить подарок (по его примерной цене в рублях).",
    cta: "Далее",
  },
  {
    id: "give-publish",
    target: '[data-tour="give-publish"]',
    text:
      "Готово? Жми «Выложить подарок» — и он сразу появится в ленте, а тебе начислятся баллы 🎁",
    advanceOn: "gift-published",
  },
  {
    id: "give-done",
    target: '[data-tour="tab-home"]',
    text:
      "Поздравляю — твой подарок опубликован! 🎉 Вернёмся на Главную: нажми «Главная» 🏠",
    advanceOn: "home-opened",
  },
  {
    id: "home-stats",
    target: '[data-tour="home-stats"]',
    text:
      "Здесь видно, сколько сейчас во всём сервисе активных подарков, уже подаренных и загаданных желаний.",
    cta: "Далее",
  },
  {
    id: "home-search",
    target: '[data-tour="home-search"]',
    text:
      "А здесь — поиск по ленте: можно найти подарок или желание по словам. Введи запрос и нажми ✈️.",
    cta: "Далее",
  },
  {
    id: "home-gifted",
    target: '[data-tour="feed-tab-gifts"]',
    text:
      "Кнопка «Подарили» открывает ленту уже подаренных подарков — можно посмотреть, кто и кому сделал день добрее 💝",
    cta: "Далее",
  },
  {
    id: "home-wishes",
    target: '[data-tour="feed-tab-wishes"]',
    text:
      "А кнопка «Загадали» — это лента желаний других людей: можно изучить и, возможно, исполнить какое-нибудь из них ✨",
    cta: "Далее",
  },
  {
    id: "point-profile",
    target: '[data-tour="tab-profile"]',
    text: "Пошли дальше — в Профиль!",
    advanceOn: "profile-opened",
  },
  {
    id: "profile-header",
    target: '[data-tour="header-stats"]',
    text:
      "Здесь ты видишь свои показатели: уровень, опыт и количество подарочных баллов. Более высокий уровень открывает новые возможности в игре.",
    cta: "Далее",
  },
  {
    id: "profile-xp",
    target: '[data-tour="header-levelxp"]',
    text:
      "Вот твой уровень (звёздочка с числом) и опыт XP. Уровень растёт по мере накопления XP, а XP начисляется за каждое активное действие в сервисе.",
    cta: "Далее",
  },
  {
    id: "profile-balance",
    target: '[data-tour="header-balance"]',
    text:
      "А это подарочные баллы 🎁 Они начисляются, когда ты выкладываешь и вручаешь свой подарок, и списываются, когда получаешь подарок сам.",
    cta: "Далее",
  },
  {
    id: "profile-invite",
    target: '[data-tour="invite-btn"]',
    text:
      "Чтобы подарков становилось больше — не только выкладывай свои, но и зови друзей. За каждого друга тебе +50 XP, а другу +1 балл на любой подарок!",
    cta: "Ок",
  },
  {
    id: "profile-invite-action",
    target: '[data-tour="invite-btn"]',
    text: "Пригласи первого друга прямо сейчас — жми на кнопку!",
    advanceOn: "invite-shared",
  },
  {
    id: "profile-invite-done",
    text: "Поздравляю с первым приглашением! Спасибо за доверие 💚",
    cta: "Спасибо!",
    confetti: true,
  },
  {
    id: "profile-zone",
    target: '[data-tour="profile-statustabs"]',
    text:
      "Эти три кнопки переключают твои подарки: «Активные», «Подаренные» и «Полученные». А ниже — твои желания.",
    cta: "Отлично!",
  },
  {
    id: "point-chats",
    target: '[data-tour="tab-chats"]',
    text: "И последний раздел — Чаты. Жми!",
    advanceOn: "chats-opened",
  },
  {
    id: "chats-reviews",
    target: '[data-tour="chat-filters"]',
    text:
      "Эти кнопки делят переписки: «С дарителями», «С получателями» и «Архив». О каждом взаимодействии можно оставить отзыв — быстрый или развёрнутый (развёрнутый даёт больше XP).",
    cta: "Договорились",
  },
  {
    id: "chats-admin",
    target: '[data-tour="admin-btn"]',
    text:
      "А ещё здесь можно написать админу (Лене), если есть предложения по улучшению любой части сервиса. Ставь «Подари» на рабочий стол устройства и пользуйся в нужный момент. Дари и получай подарки!",
    cta: "С удовольствием!",
  },
];

export function getStep(id: string | null): TourStep | null {
  if (!id) return null;
  return TOUR_STEPS.find((s) => s.id === id) ?? null;
}

export function nextStepId(id: string): string | null {
  const i = TOUR_STEPS.findIndex((s) => s.id === id);
  if (i < 0 || i >= TOUR_STEPS.length - 1) return null;
  return TOUR_STEPS[i + 1].id;
}
