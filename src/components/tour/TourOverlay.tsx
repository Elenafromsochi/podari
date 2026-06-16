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
    let cancelled = false;
    let scrolled = false;
    const update = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (el) {
        // Один раз на шаг подкручиваем элемент в центр, чтобы он не прятался
        // за нижней навигацией/шапкой и подсветка была видна.
        if (!scrolled) {
          scrolled = true;
          try {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          } catch {
            /* noop */
          }
        }
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
        timer = window.setTimeout(update, 400);
      }
    };
    update();
    const onMove = () => update();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    const poll = window.setInterval(update, 600);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.clearInterval(poll);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
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
                completeTour();
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
      // финал гида — отправляем человека в профиль (к достижениям)
      completeTour();
      navigate({ to: "/cabinet" });
    }
  };

  const skip = () => completeTour();

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

  // позиционирование карточки
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let cardTop = vh / 2 - 110;
  if (hole) {
    // высокую область (например, длинную ленту) не обойти — ставим подсказку
    // наверх, чтобы не закрывать её середину.
    if (hole.height > vh * 0.55) {
      cardTop = 92;
    } else {
      // есть подсвеченная область — ставим карточку над или под ней, чтобы не закрывать
      const below = hole.top + hole.height + 16;
      const above = hole.top - 16 - 200;
      cardTop = hole.top + hole.height / 2 < vh / 2
        ? Math.min(vh - 220, below)
        : Math.max(16, above);
    }
  } else if (waitsForAction) {
    cardTop = 92;
  }
  // Шаг про описание при дарении: подсказку ставим ПОД зоной описания (под
  // «Дополнить с ИИ»), чтобы вся зона — фото, файл, текст, кнопка ИИ —
  // оставалась открытой, и можно было выбрать любой способ.
  if (step.id === "give-photo") {
    cardTop = hole
      ? Math.min(vh - 210, hole.top + hole.height + 12)
      : 64;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] animate-fade-in">
      {/* Без затемнения: только яркое пульсирующее кольцо вокруг нужной
          кнопки/области, чтобы «вести» взгляд. Страница полностью кликабельна. */}
      {hole && (
        <div
          className="pointer-events-none absolute rounded-2xl ring-4 ring-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.35)] animate-pulse transition-all"
          style={hole}
        />
      )}

      <div
        className="pointer-events-auto absolute left-1/2 w-[90%] max-w-sm -translate-x-1/2 rounded-2xl bg-lavender p-4 text-lavender-foreground shadow-xl ring-1 ring-lavender-foreground/15 animate-scale-in"
        style={{ top: cardTop }}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-medium uppercase tracking-wider text-lavender-foreground/70">
            Гид по «Подари»
          </span>
          <button
            onClick={skip}
            className="text-[11px] text-lavender-foreground/70 underline-offset-4 hover:underline"
          >
            Пропустить
          </button>
        </div>
        <p className="whitespace-pre-line text-[15px] font-medium leading-snug">{displayText}</p>
        {step.cta && (
          <button
            onClick={advance}
            className="mt-3 w-full rounded-xl bg-mint px-4 py-2.5 text-sm font-semibold text-mint-foreground transition active:scale-[0.98] hover:bg-mint/90"
          >
            {step.cta}
          </button>
        )}
        {!step.cta && (
          <p className="mt-2 text-center text-[11px] text-lavender-foreground/70">
            👆 сделай шаг, и я продолжу
          </p>
        )}
      </div>
    </div>
  );
}
