import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import confetti from "canvas-confetti";
import {
  completeTour,
  getStep,
  getTourSnapshot,
  nextStepId,
  restartTour,
  setTourStep,
  TOUR_STEPS,
  useTourState,
} from "@/lib/tour";

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
    const update = () => {
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

  if (state.done) return null;

  // Возврат после перезагрузки: спрашиваем, а не показываем шаг вслепую.
  if (askResume) {
    return (
      <div className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-6 animate-fade-in">
        <div className="w-full max-w-sm rounded-2xl bg-background p-5 text-center shadow-xl animate-scale-in">
          <p className="text-base font-semibold">Продолжим знакомство с сервисом?</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ты не закончил гид. Пройти его заново с начала — это быстро и по шагам.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={() => {
                setAskResume(false);
                navigate({ to: "/" });
                restartTour();
              }}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition active:scale-[0.98] hover:opacity-90"
            >
              Пройти гид заново
            </button>
            <button
              onClick={() => {
                setAskResume(false);
                completeTour();
              }}
              className="w-full rounded-xl border px-4 py-2.5 text-sm text-muted-foreground transition hover:bg-accent"
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
    else completeTour();
  };

  const skip = () => completeTour();

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

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] animate-fade-in">
      {waitsForAction ? (
        // Шаг-действие: страницу НЕ закрываем и не затемняем. Если нашли
        // нужную область — обводим её кольцом (подсветка), но клики проходят
        // насквозь, и карточка-подсказка стоит так, чтобы её не перекрывать.
        hole ? (
          <div
            className="pointer-events-none absolute rounded-2xl ring-4 ring-primary/80 transition-all"
            style={hole}
          />
        ) : null
      ) : hole ? (
        <>
          {/* 4 затемнения вокруг дырки — клики по тёмным зонам перехватываются
              (pointer-events-auto), а сама дырка остаётся «сквозной». */}
          <div
            className="pointer-events-auto absolute bg-black/55"
            style={{ left: 0, top: 0, right: 0, height: Math.max(0, hole.top) }}
          />
          <div
            className="pointer-events-auto absolute bg-black/55"
            style={{
              left: 0,
              top: hole.top + hole.height,
              right: 0,
              bottom: 0,
            }}
          />
          <div
            className="pointer-events-auto absolute bg-black/55"
            style={{
              left: 0,
              top: hole.top,
              width: Math.max(0, hole.left),
              height: hole.height,
            }}
          />
          <div
            className="pointer-events-auto absolute bg-black/55"
            style={{
              left: hole.left + hole.width,
              top: hole.top,
              right: 0,
              height: hole.height,
            }}
          />
          <div
            className="pointer-events-none absolute rounded-2xl ring-4 ring-primary/80 transition-all"
            style={hole}
          />
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-black/60" />
      )}

      <div
        className="pointer-events-auto absolute left-1/2 w-[90%] max-w-sm -translate-x-1/2 rounded-2xl bg-background p-4 shadow-xl animate-scale-in"
        style={{ top: cardTop }}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Гид по «Подари»
          </span>
          <button
            onClick={skip}
            className="text-[11px] text-muted-foreground underline-offset-4 hover:underline"
          >
            Пропустить
          </button>
        </div>
        <p className="text-[15px] leading-snug">{step.text}</p>
        {step.cta && (
          <button
            onClick={advance}
            className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition active:scale-[0.98] hover:opacity-90"
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
  );
}
