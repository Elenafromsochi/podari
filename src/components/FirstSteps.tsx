import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown } from "lucide-react";
import { getOnboardingSteps } from "@/lib/cozy.functions";
import { getTourSnapshot, restartTour } from "@/lib/tour";
import { haptic } from "@/lib/haptics";

type DbSteps = {
  chosen: boolean;
  messaged: boolean;
  posted: boolean;
  invited: boolean;
  received: boolean;
  reviewed: boolean;
  gifted: boolean;
};

const COLLAPSE_KEY = "cozygift_firststeps_collapsed";

/** Трекер «Первые шаги» — 8 достижений новичка. Засчитываются в любом порядке,
 *  как только человек сделал действие. Скрывается, когда все 8 пройдены. */
export function FirstSteps() {
  const navigate = useNavigate();
  const stepsFn = useServerFn(getOnboardingSteps);
  const [db, setDb] = useState<DbSteps | null>(null);
  const [tourDone, setTourDone] = useState(false);
  const [invitedLocal, setInvitedLocal] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    stepsFn()
      .then((r) => {
        if (alive) setDb(r as DbSteps);
      })
      .catch(() => {});
    setTourDone(getTourSnapshot().done);
    if (typeof localStorage !== "undefined") {
      setInvitedLocal(localStorage.getItem("cozygift_invited") === "1");
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    }
    return () => {
      alive = false;
    };
  }, [stepsFn]);

  if (!db) return null;

  const steps = [
    { emoji: "🎁", label: "Выбрать первый подарок", done: db.chosen },
    { emoji: "💬", label: "Написать первое сообщение в чате", done: db.messaged },
    { emoji: "📤", label: "Разместить свой подарок", done: db.posted },
    { emoji: "👯", label: "Пригласить друга", done: db.invited || invitedLocal },
    { emoji: "🎓", label: "Пройти обучение (гид)", done: tourDone },
    { emoji: "📥", label: "Получить первый подарок", done: db.received },
    { emoji: "💌", label: "Оставить первый отзыв", done: db.reviewed },
    { emoji: "🤝", label: "Вручить свой подарок", done: db.gifted },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;

  // Все пройдены — поздравляем и больше не показываем.
  if (doneCount >= total) {
    return (
      <section className="mb-5 rounded-3xl border border-mint/50 bg-mint/15 p-4 text-center">
        <p className="text-base font-semibold">🎉 Все первые шаги пройдены!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ты освоил «Подари». Спасибо, что делишься теплом 💚
        </p>
      </section>
    );
  }

  const pct = Math.round((doneCount / total) * 100);

  const toggle = () => {
    haptic("select");
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
  };

  return (
    <section className="mb-5 rounded-3xl border border-mint/50 bg-mint/15 p-4">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">🌱 Твои первые шаги</h2>
          <span className="shrink-0 rounded-full bg-background px-2.5 py-0.5 text-xs font-semibold text-foreground">
            {doneCount} из {total}
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${
            collapsed ? "" : "rotate-180"
          }`}
        />
      </button>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {!collapsed && (
        <>
          <ul className="mt-3 space-y-1.5">
            {steps.map((s) => (
              <li
                key={s.label}
                className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm ${
                  s.done ? "bg-background/50" : "bg-background/80"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    s.done ? "bg-emerald-500 text-white" : "border border-muted-foreground/40"
                  }`}
                >
                  {s.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className={s.done ? "text-muted-foreground line-through" : "font-medium"}>
                  {s.emoji} {s.label}
                </span>
              </li>
            ))}
          </ul>

          {!tourDone && (
            <button
              type="button"
              onClick={() => {
                haptic("medium");
                navigate({ to: "/" });
                restartTour();
              }}
              className="mt-3 w-full rounded-2xl bg-mint px-4 py-2.5 text-sm font-semibold text-mint-foreground transition active:scale-[0.98] hover:bg-mint/90"
            >
              🧭 Пройти обучение
            </button>
          )}
        </>
      )}
    </section>
  );
}
