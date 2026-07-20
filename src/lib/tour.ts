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
      "Привет, друг! 💚\n\nЭтот сервис создан, чтобы дарить и выбирать подарки, а также загадывать свои желания и исполнять чужие.",
    cta: "Далее",
    confetti: true,
  },
  {
    id: "home-actions",
    target: '[data-tour="home-actions"]',
    text:
      "Вот три главные кнопки:\n\n🎁 «Подарить» — отдать своё или исполнить чьё-то желание;\n💝 «Получить» — выбрать подарок себе;\n💫 «Загадать» — загадать своё желание.",
    cta: "Далее",
  },
  {
    id: "point-receive",
    target: '[data-tour="receive-btn"]',
    text:
      "Для начала выбери себе подарок — один из тех, что подарили другие участники. Нажми «Получить» 👆",
    advanceOn: "receive-opened",
  },
  {
    id: "kinds-explain",
    target: '[data-tour="tour-spot"]',
    text:
      "На 1 уровне тебе доступны категории «Вещи» и «Услуги и время» — выбери что-нибудь, и сразу увидишь подарки.",
    advanceOn: "kind-picked",
  },
  {
    id: "feed-explain",
    target: '[data-tour="tour-spot"]',
    text: "Ты добрался до настоящих сокровищ 💎 Выбери любой подарок и нажми «Получить за 1 балл».",
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
      "Ты в чате с дарителем 💬 Выбери готовое сообщение кнопкой или напиши своё — договоритесь о времени и месте, где заберёшь подарок.\n\n👉 Отправь сообщение, потом жми «Готово».",
    cta: "Готово",
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
    id: "give-intro",
    text:
      "На 1 уровне можно дарить и получать подарки стоимостью до 3000 ₽ (это 1 балл). Чем выше уровень — тем дороже подарки.",
    cta: "Ок",
  },
  {
    id: "give-photo",
    target: '[data-tour="give-step1"]',
    text:
      "Шаг 1 — покажи или опиши свой подарок: добавь фото/файл (ИИ опишет сам) либо напиши пару слов и нажми «✨ Дополнить с ИИ». Когда готово — жми «Готово» 👇",
    cta: "Готово",
  },
  {
    id: "give-image",
    target: '[data-tour="give-step2"]',
    text:
      "Шаг 2 — добавь картинку: можно сгенерировать её по описанию 🎨 или загрузить своё фото. (Если это шаг с описанием — просто проверь текст.)",
    cta: "Далее",
  },
  {
    id: "give-condition",
    target: '[data-tour="give-condition"]',
    text:
      "Здесь можно дарить и б/у вещи — поэтому фотографируй честно. ИИ оценит состояние звёздами ★ (5 — как новое, 1 — сильно использованное). Если ИИ ошибся — поменяй количество звёзд вручную.",
    cta: "Ок",
  },
  {
    id: "give-cost",
    target: '[data-tour="give-cost"]',
    text:
      "Теперь выбери, во сколько баллов оценить подарок (по его примерной цене в рублях).",
    cta: "Далее",
  },
  {
    id: "give-city",
    target: '[data-tour="give-city"]',
    text:
      "Укажи город, где можно забрать вещь или встретиться. А если это онлайн (например, консультация или медитация) — поставь галочку «🌐 Онлайн», и город не понадобится.",
    cta: "Далее",
  },
  {
    id: "give-publish",
    target: '[data-tour="give-publish"]',
    text:
      "Готово? Жми «Подарить подарок» — он появится в ленте, а тебе начислятся баллы 🎁\n\n💡 А если хочешь подарить кому-то одному — поставь галочку «🔒 Подарить конкретному человеку»: подарок будет доступен только по ссылке.",
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
      "Эти кнопки переключают твои подарки: «Активные», «Брони» (забронированные — выбрал, но ещё не получил), «Подаренные» и «Полученные». А ниже — твои желания.",
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
      "А ещё здесь можно написать админу (Лене), если есть предложения по улучшению любой части сервиса.",
    cta: "Понятно",
  },
  {
    id: "save-app",
    text:
      "Сохрани «Подари» на рабочий стол смартфона — и пользуйся в нужный момент. Повышай уровень, дари и получай подарки! 💚",
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

// Возобновление гида: шаги внутри временных экранов (получение/чат/дарение/
// профиль/чаты) нельзя показать «вслепую» — их нужно перезайти. Поэтому при
// возврате продолжаем С НАЧАЛА той секции, где человек остановился, а шаги на
// стабильных экранах (главная) — прямо с них.
const SECTION_ENTRY: Record<string, string> = {
  // Получение подарка
  "kinds-explain": "point-receive",
  "feed-explain": "point-receive",
  "chat-freeze": "point-receive",
  "chat-templates": "point-receive",
  "chat-decline": "point-receive",
  "point-nav": "point-receive",
  // Дарение
  "give-start": "give-start",
  "give-kind": "give-start",
  "give-intro": "give-start",
  "give-photo": "give-start",
  "give-condition": "give-start",
  "give-cost": "give-start",
  "give-city": "give-start",
  "give-publish": "give-start",
  "give-done": "give-start",
  // Профиль
  "point-profile": "point-profile",
  "profile-header": "point-profile",
  "profile-xp": "point-profile",
  "profile-balance": "point-profile",
  "profile-invite": "point-profile",
  "profile-invite-action": "point-profile",
  "profile-invite-done": "point-profile",
  "profile-zone": "point-profile",
  // Чаты
  "point-chats": "point-chats",
  "chats-reviews": "point-chats",
  "chats-admin": "point-chats",
  "save-app": "point-chats",
};

/** С какого шага продолжить гид при возврате (начало незавершённой секции). */
export function resumeStepId(saved: string | null): string {
  if (!saved) return TOUR_STEPS[0].id;
  return SECTION_ENTRY[saved] ?? saved;
}
