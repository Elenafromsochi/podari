import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown } from "lucide-react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
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

type StepKey = keyof DbSteps | "tour";

const STEP_DEFS: { key: StepKey; emoji: string; label: string }[] = [
  { key: "chosen", emoji: "🎁", label: "Выбрать первый подарок" },
  { key: "messaged", emoji: "💬", label: "Написать первое сообщение в чате" },
  { key: "posted", emoji: "📤", label: "Разместить свой подарок" },
  { key: "invited", emoji: "👯", label: "Пригласить друга" },
  { key: "tour", emoji: "🎓", label: "Пройти обучение (гид)" },
  { key: "received", emoji: "📥", label: "Получить первый подарок" },
  { key: "reviewed", emoji: "💌", label: "Оставить первый отзыв" },
  { key: "gifted", emoji: "🤝", label: "Вручить свой подарок" },
];

const COLLAPSE_KEY = "cozygift_firststeps_collapsed";
const CELEBRATED_KEY = "cozygift_steps_celebrated";

/** Трекер «Первые шаги» — 8 достижений новичка. Засчитываются в любом порядке.
 *  При выполнении нового шага — салют и поздравление. Скрывается, когда все 8. */
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
      // По умолчанию свёрнут (чтобы не занимать ленту); раскрыт только если
      // пользователь явно развернул («0»).
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) !== "0");
    }
    return () => {
      alive = false;
    };
  }, [stepsFn]);

  const isDone = (key: StepKey): boolean => {
    if (!db) return false;
    if (key === "tour") return tourDone;
    if (key === "invited") return db.invited || invitedLocal;
    return db[key];
  };

  // Салют за новые выполненные шаги (по сравнению с прошлым просмотром).
  useEffect(() => {
    if (!db || typeof localStorage === "undefined") return;
    const doneKeys = STEP_DEFS.filter((d) => isDone(d.key)).map((d) => d.key);
    let celebrated: string[] | null = null;
    try {
      const raw = localStorage.getItem(CELEBRATED_KEY);
      celebrated = raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      celebrated = null;
    }
    if (celebrated === null) {
      // Первый просмотр — фиксируем текущие как уже отмеченные, без салюта.
      try {
        localStorage.setItem(CELEBRATED_KEY, JSON.stringify(doneKeys));
      } catch {
        /* noop */
      }
      return;
    }
    const newly = doneKeys.filter((k) => !celebrated!.includes(k));
    if (newly.length) {
      confetti({ particleCount: 130, spread: 85, origin: { y: 0.4 }, scalar: 1.1 });
      haptic("success");
      for (const k of newly) {
        const d = STEP_DEFS.find((x) => x.key === k);
        if (d) {
          toast.success(`🎉 ${d.emoji} ${d.label} — выполнено!`, {
            description: "Шаг из «Первых шагов» пройден 💚",
          });
        }
      }
      try {
        localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...celebrated, ...newly]));
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, tourDone, invitedLocal]);

  if (!db) return null;

  const steps = STEP_DEFS.map((d) => ({ ...d, done: isDone(d.key) }));
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;

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
                key={s.key}
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
