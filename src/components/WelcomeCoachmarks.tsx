import { useEffect, useState } from "react";

// Лёгкий онбординг при первом заходе: 3 шага-подсказки.
// Подсветка делается через затемнённый оверлей с прозрачным окном вокруг таргета.

const KEY = "cozygift_coachmarks_seen_v1";

type Step = {
  selector: string;
  title: string;
  text: string;
  placement: "top" | "bottom";
};

const STEPS: Step[] = [
  {
    selector: '[data-coach="receive"]',
    title: "Шаг 1 — забери подарок 🎁",
    text: "У тебя уже есть 1 подарочный балл. Загляни в ленту и выбери что-то приятное — это бесплатно и быстро.",
    placement: "bottom",
  },
  {
    selector: '[data-coach="give"]',
    title: "Шаг 2 — подари в ответ 💚",
    text: "Когда подаришь — баланс восстановится, а ты получишь +20 XP за публикацию и ещё +80 за встречу.",
    placement: "bottom",
  },
  {
    selector: '[data-coach="cabinet"]',
    title: "Шаг 3 — следи за прогрессом ✨",
    text: "В личном кабинете видны XP, уровни и баллы. Нажми на «?» рядом с цифрой — там всё объяснено.",
    placement: "top",
  },
];

export function WelcomeCoachmarks({ userXp = 0 }: { userXp?: number }) {
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(KEY)) return;
    // Если пользователь уже что-то делал в приложении — обучение не показываем,
    // даже если localStorage был очищен (например, заход с другого домена).
    if (userXp > 0) {
      localStorage.setItem(KEY, "1");
      return;
    }
    // Запускаем после первого рендера welcome-экрана
    const t = setTimeout(() => setActive(true), 500);
    return () => clearTimeout(t);
  }, [userXp]);

  useEffect(() => {
    if (!active) return;
    const step = STEPS[idx];
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      // Если таргет не нашёлся — пропускаем шаг
      next();
      return;
    }
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx]);

  const finish = () => {
    localStorage.setItem(KEY, "1");
    setActive(false);
  };

  const next = () => {
    if (idx >= STEPS.length - 1) finish();
    else setIdx((i) => i + 1);
  };

  if (!active || !rect) return null;

  const pad = 8;
  const hole = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };

  const step = STEPS[idx];
  const tipTop =
    step.placement === "bottom"
      ? Math.min(window.innerHeight - 180, hole.top + hole.height + 12)
      : Math.max(16, hole.top - 160);

  return (
    <div className="fixed inset-0 z-[60] animate-fade-in">
      {/* затемнение с «дыркой» через 4 div'а вокруг таргета */}
      <div
        className="absolute bg-black/55"
        style={{ left: 0, top: 0, right: 0, height: hole.top }}
      />
      <div
        className="absolute bg-black/55"
        style={{ left: 0, top: hole.top + hole.height, right: 0, bottom: 0 }}
      />
      <div
        className="absolute bg-black/55"
        style={{ left: 0, top: hole.top, width: hole.left, height: hole.height }}
      />
      <div
        className="absolute bg-black/55"
        style={{
          left: hole.left + hole.width,
          top: hole.top,
          right: 0,
          height: hole.height,
        }}
      />
      {/* рамка вокруг таргета */}
      <div
        className="pointer-events-none absolute rounded-2xl ring-4 ring-primary/80 transition-all"
        style={hole}
      />

      {/* карточка подсказки */}
      <div
        className="absolute left-1/2 w-[90%] max-w-sm -translate-x-1/2 rounded-2xl bg-background p-4 shadow-xl animate-scale-in"
        style={{ top: tipTop }}
      >
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {idx + 1} из {STEPS.length}
        </div>
        <h3 className="text-base font-semibold">{step.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            onClick={finish}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Пропустить
          </button>
          <button
            onClick={next}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            {idx === STEPS.length - 1 ? "Готово" : "Дальше →"}
          </button>
        </div>
      </div>
    </div>
  );
}
