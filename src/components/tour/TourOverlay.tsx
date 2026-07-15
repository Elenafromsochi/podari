import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import confetti from "canvas-confetti";
import {
  completeTour,
  getStep,
  getTourSnapshot,
  nextStepId,
  restartTour,
  resumeStepId,
  setTourStep,
  TOUR_STEPS,
  useTourState,
} from "@/lib/tour";
import { GIFT_KINDS } from "@/lib/gift-kinds";

/** Уровень и баланс пользователя из кэша профиля — чтобы гид подстраивал текст. */
function readCachedProfile(): { level: number; balance: number } {
  if (typeof localStorage === "undefined") return { level: 1, balance: 1 };
  try {
    const raw = localStorage.getItem("cozygift_last_profile");
    if (raw) {
      const p = JSON.parse(raw) as { level?: number; balance?: number | string };
      const level = typeof p.level === "number" && p.level > 0 ? p.level : 1;
      const balance = Number(p.balance ?? 1);
      return { level, balance: Number.isFinite(balance) ? balance : 1 };
    }
  } catch {
    /* noop */
  }
  return { level: 1, balance: 1 };
}

function fmtBal(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function ballWord(n: number): string {
  if (!Number.isInteger(n)) return "балла";
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "балл";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "балла";
  return "баллов";
}

function giftWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "подарок";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "подарка";
  return "подарков";
}

/** Первый шаг гида подстраивается под реальный баланс пользователя. */
function balanceStepText(): string {
  const { balance } = readCachedProfile();
  const b = Math.round(balance * 10) / 10;
  if (b >= 1) {
    const max = Math.floor(b);
    const extra = max >= 2 ? " (или несколько подешевле)" : "";
    return `У тебя ${fmtBal(b)} ${ballWord(b)} — можешь выбрать подарок ценой до ${max} ${ballWord(max)}${extra}. Покажу, как 🎁`;
  }
  if (b <= 0) {
    return "Пока у тебя 0 баллов. Чтобы выбрать подарок, нужен 1 балл — выкладывай свои подарки, каждый даёт +0.2 балла, так баланс и наберётся.";
  }
  const need = Math.max(1, Math.ceil((1 - b) / 0.2 - 1e-9));
  return `Сейчас у тебя ${fmtBal(b)} ${ballWord(b)}. Чтобы накопить 1 балл и выбрать подарок, выложи ещё ${need} ${giftWord(need)} — каждый даёт +0.2 балла.`;
}

/** Текст шага «ты попал в чат» — число замороженных баллов из стоимости
 *  только что выбранного подарка. */
function freezeStepText(): string {
  let cost = 1;
  try {
    const raw = localStorage.getItem("cozygift_last_claim_cost");
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) cost = n;
  } catch {
    /* noop */
  }
  const m10 = cost % 10;
  const m100 = cost % 100;
  const verb =
    m10 === 1 && m100 !== 11
      ? "заморозился"
      : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)
        ? "заморозились"
        : "заморозилось";
  return `Ты попал в чат с Дарителем — и в этот момент у тебя ${verb} ${cost} ${ballWord(cost)} 🔒`;
}

/** Вводный шаг дарения: лимит цены подарка по уровню. */
function giveIntroStepText(): string {
  const { level } = readCachedProfile();
  if (level <= 1) {
    return "На 1 уровне можно дарить и получать подарки стоимостью до 3000 ₽ (это 1 балл). Чем выше твой уровень — тем дороже подарки можно дарить и получать 💚";
  }
  const cap = Math.min(level, 5);
  const rub = (cap * 3000).toLocaleString("ru-RU");
  return `На твоём уровне можно дарить и получать подарки стоимостью до ${rub} ₽ (до ${cap} ${ballWord(cap)}). Чем выше уровень — тем дороже подарки 💚`;
}

/** Текст шага про стоимость: новичку — про 1 балл (до 3000 ₽) и рост уровня. */
function giveCostStepText(): string {
  const { level } = readCachedProfile();
  if (level <= 1) {
    return "Сейчас, на 1 уровне, твой подарок — до 3000 ₽, это 1 балл. Дальше, с ростом уровня, ты сможешь дарить и получать более ценные подарки 💚";
  }
  return "Выбери, во сколько баллов оценить подарок — ориентируйся на его примерную стоимость в рублях.";
}

/** Текст шага «выбери категорию» подстраивается под уровень: перечисляет
 *  доступные категории, а если открыто всё — так и пишет. */
function kindsStepText(): string {
  const level = readCachedProfile().level;
  const open = GIFT_KINDS.filter((k) => level >= k.minLevel);
  if (open.length >= GIFT_KINDS.length) {
    return "Тебе уже открыты все категории — выбери любую 🎁";
  }
  const names = open.map((k) => `«${k.shortLabel}»`).join(", ");
  return `На твоём уровне доступны: ${names} — выбери что-нибудь.`;
}

function burst() {
  const opts = { spread: 80, ticks: 200, gravity: 0.9, scalar: 1.1 } as const;
  confetti({ ...opts, particleCount: 70, origin: { x: 0.25, y: 0.6 } });
  confetti({ ...opts, particleCount: 70, origin: { x: 0.75, y: 0.6 } });
  setTimeout(
    () => confetti({ ...opts, particleCount: 100, origin: { x: 0.5, y: 0.45 } }),
    220,
  );
}

export function TourOverlay() {
  const state = useTourState();
  const step = getStep(state.step);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const navigate = useNavigate();

  // Решаем ОДИН раз при загрузке страницы: если гид сохранён не на первом
  // шаге и не завершён — значит человек вернулся после перезагрузки/повторного
  // входа. Не показываем подсказку вслепую (она может оказаться не на той
  // странице), а спрашиваем: пройти заново или закрыть.
  const [askResume, setAskResume] = useState(() => {
    const s = getTourSnapshot();
    return !!s.step && !s.done && s.step !== TOUR_STEPS[0].id;
  });
  // Шаг, на котором остановились (для «Продолжить с незавершённого»).
  const [resumeFrom] = useState(() => getTourSnapshot().step);

  // конфетти при появлении шага
  useEffect(() => {
    if (step?.confetti) burst();
  }, [step?.id]);

  // ищем таргет (с авто-ретраями — элемент может появиться позже)
  useEffect(() => {
    if (!step?.target) {
      setRect(null);
      return;
    }
    let timer: number | null = null;
    let raf: number | null = null;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) => {
          if (
            prev &&
            prev.top === r.top &&
            prev.left === r.left &&
            prev.width === r.width &&
            prev.height === r.height
          ) {
            return prev;
          }
          return r;
        });
      } else {
        setRect(null);
        timer = window.setTimeout(measure, 400);
      }
    };
    // На скролл/resize пересчитываем не чаще раза в кадр (rAF) — иначе на iOS
    // частые getBoundingClientRect во время инерционного скролла вешают поток.
    const schedule = () => {
      if (raf != null) return;
      raf = window.requestAnimationFrame(() => {
        raf = null;
        measure();
      });
    };
    measure();
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    const poll = window.setInterval(measure, 800);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (raf != null) window.cancelAnimationFrame(raf);
      window.clearInterval(poll);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [step?.target, step?.id]);

  // продвижение по событию
  useEffect(() => {
    if (!step?.advanceOn) return;
    const h = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === step.advanceOn) advance();
    };
    window.addEventListener("cozy:tour-event", h);
    return () => window.removeEventListener("cozy:tour-event", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.advanceOn, step?.id]);

  // Шаг про состояние нужен только для вещей; у услуги/встречи — пропускаем.
  useEffect(() => {
    if (step?.id !== "give-condition") return;
    let kind = "used_item";
    try {
      kind = localStorage.getItem("cozygift_tour_give_kind") || "used_item";
    } catch {
      /* noop */
    }
    if (kind !== "used_item") advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  if (state.done) return null;

  // Возврат после перезагрузки: спрашиваем, а не показываем шаг вслепую.
  if (askResume) {
    return (
      <div className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-6 animate-fade-in">
        <div className="w-full max-w-sm rounded-2xl bg-background p-5 text-center shadow-xl animate-scale-in">
          <p className="text-base font-semibold">Продолжим знакомство с сервисом?</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ты не закончил гид. Продолжим с того места, где остановился?
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={() => {
                setAskResume(false);
                navigate({ to: "/" });
                setTourStep(resumeStepId(resumeFrom));
              }}
              className="w-full rounded-xl bg-mint px-4 py-2.5 text-sm font-semibold text-mint-foreground transition active:scale-[0.98] hover:bg-mint/90"
            >
              Продолжить
            </button>
            <button
              onClick={() => {
                setAskResume(false);
                navigate({ to: "/" });
                restartTour();
              }}
              className="w-full rounded-xl border px-4 py-2.5 text-sm text-foreground transition hover:bg-accent"
            >
              Начать с начала
            </button>
            <button
              onClick={() => {
                setAskResume(false);
                // Гид брошен на полпути — пометим для плашки «сообщить об ошибке».
                try {
                  localStorage.setItem("cozygift_tour_report_prompt", "1");
                } catch {
                  /* noop */
                }
                completeTour();
                window.dispatchEvent(new Event("cozy:tour-exit"));
              }}
              className="w-full rounded-xl px-4 py-2 text-sm text-muted-foreground transition hover:bg-accent"
            >
              Не сейчас
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!step) return null;

  const advance = () => {
    const nxt = nextStepId(step.id);
    if (nxt) setTourStep(nxt);
    else {
      // финал гида пройден полностью — плашку «сообщить об ошибке» НЕ показываем.
      try {
        localStorage.removeItem("cozygift_tour_report_prompt");
      } catch {
        /* noop */
      }
      // отправляем человека в профиль (к достижениям)
      completeTour();
      navigate({ to: "/", search: { tab: "profile" } as never });
    }
  };

  // Ранний выход из гида (не дошёл до конца): помечаем, чтобы показать плашку
  // с предложением прислать скриншот ошибки (TourExitReport).
  const exitEarly = () => {
    try {
      localStorage.setItem("cozygift_tour_report_prompt", "1");
    } catch {
      /* noop */
    }
    completeTour();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("cozy:tour-exit"));
  };

  const skip = () => exitEarly();

  // Динамические шаги: первый — под баланс, «выбери категорию» — под уровень,
  // «попал в чат» — число замороженных баллов из стоимости подарка.
  const displayText =
    step.id === "auth-confetti"
      ? balanceStepText()
      : step.id === "kinds-explain"
        ? kindsStepText()
        : step.id === "chat-freeze"
          ? freezeStepText()
          : step.id === "give-intro"
          ? giveIntroStepText()
          : step.id === "give-cost"
            ? giveCostStepText()
            : step.text;

  const pad = 8;
  const hasHole = !!rect;
  const hole = hasHole
    ? {
        top: rect!.top - pad,
        left: rect!.left - pad,
        width: rect!.width + pad * 2,
        height: rect!.height + pad * 2,
      }
    : null;

  // Шаг ждёт действия на самой странице (advanceOn): страницу НЕ блокируем,
  // нужную область только подсвечиваем кольцом, а подсказку держим сверху —
  // так она не закрывает кнопки, которые надо нажать.
  const waitsForAction = !!step.advanceOn;

  // Позиционирование карточки. Правило: подсказка НЕ должна перекрывать заголовки
  // и подсвеченную область. Заголовки почти всегда сверху, поэтому по умолчанию
  // держим карточку ВНИЗУ (над нижней навигацией). Если подсвеченная область сама
  // внизу — уводим карточку наверх, чтобы её не закрыть.
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const bottomPos = Math.max(120, vh - 230);
  let cardTop: number;
  if (hole) {
    const holeCenter = hole.top + hole.height / 2;
    cardTop = holeCenter < vh * 0.55 ? bottomPos : 92;
  } else if (waitsForAction) {
    cardTop = bottomPos;
  } else {
    // Чисто текстовый шаг: фон затемнён целиком, заголовки не видны — можно по центру.
    cardTop = vh / 2 - 110;
  }
  // Шаг про описание при дарении: держим ВНИЗУ, чтобы не накрывать кнопки формы.
  if (step.id === "give-photo") {
    cardTop = Math.max(120, vh - 180);
  }

  return (
    <>
      {/* Слой затемнения держим НИЖЕ нижней навигации (z-40 < nav z-50): так
          вкладки «Главная/Профиль/Чаты» во время гида остаются яркими и
          кликабельными, а раньше тёмный слой их перекрывал и вход не срабатывал.
          Слой не ловит нажатия (pointer-events-none). */}
      <div className="pointer-events-none fixed inset-0 z-40 animate-fade-in">
        {hole ? (
          <div
            className="pointer-events-none absolute rounded-2xl"
            style={{ ...hole, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 bg-black/55" />
        )}
      </div>

      {/* Кольцо и карточка — ВЫШЕ навигации, чтобы подсветка и подсказка читались
          поверх всего, включая вкладки. */}
      <div className="pointer-events-none fixed inset-0 z-[80]">
        {/* яркое пульсирующее кольцо вокруг подсвеченной кнопки/области */}
        {hole && (
          <div
            className="pointer-events-none absolute rounded-2xl ring-4 ring-primary shadow-[0_0_0_5px_rgba(205,180,122,0.6)] animate-pulse"
            style={hole}
          />
        )}

        <div
          className="pointer-events-auto absolute left-1/2 w-[90%] max-w-sm -translate-x-1/2 rounded-2xl border border-primary/25 bg-background p-4 text-foreground shadow-2xl animate-scale-in"
          style={{ top: cardTop }}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-primary">
              🌿 Гид по «Подари»
            </span>
            <button
              onClick={skip}
              className="text-[11px] text-muted-foreground underline-offset-4 hover:underline"
            >
              Пропустить
            </button>
          </div>
          <p className="whitespace-pre-line text-[15px] font-medium leading-snug text-foreground">
            {displayText}
          </p>
          {step.cta && (
            <button
              onClick={advance}
              className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition active:scale-[0.98] hover:bg-primary/90"
            >
              {step.cta}
            </button>
          )}
          {!step.cta && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              👆 сделай шаг, и я продолжу
            </p>
          )}
        </div>
      </div>
    </>
  );
}
