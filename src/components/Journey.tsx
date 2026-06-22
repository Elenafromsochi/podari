import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, Lock } from "lucide-react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { getOnboardingSteps } from "@/lib/cozy.functions";
import { getTourSnapshot, restartTour } from "@/lib/tour";
import { haptic } from "@/lib/haptics";
import type { JourneyStats } from "@/components/Achievements";

type DbSteps = {
  chosen: boolean;
  messaged: boolean;
  posted: boolean;
  invited: boolean;
  received: boolean;
  reviewed: boolean;
  gifted: boolean;
};

type Task = {
  key: string;
  emoji: string;
  label: string;
  done: boolean;
  value?: number;
  target?: number;
  xp?: number;
};

type Stage = {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  tasks: Task[];
};

const COLLAPSE_KEY = "cozygift_journey_collapsed";
const CELEBRATED_STAGES_KEY = "cozygift_journey_stages_done";

/** Прогресс-задача с числовой целью (например, «3 из 5 друзей»). */
const goal = (
  key: string,
  emoji: string,
  label: string,
  value: number,
  target: number,
  xp?: number,
): Task => ({ key, emoji, label, done: value >= target, value, target, xp });

export type { DbSteps, Stage, Task };

export function buildStages(
  db: DbSteps,
  tourDone: boolean,
  invited: boolean,
  stats: JourneyStats | null,
): Stage[] {
  const stages: Stage[] = [];

  // Ступень 1 — первые шаги новичка (в любом порядке).
  stages.push({
    id: "first_steps",
    emoji: "🌱",
    title: "Твои первые шаги",
    subtitle: "Освойся в «Подари»",
    tasks: [
      { key: "chosen", emoji: "🎁", label: "Выбрать первый подарок", done: db.chosen },
      { key: "messaged", emoji: "💬", label: "Написать сообщение в чате", done: db.messaged },
      { key: "posted", emoji: "📤", label: "Разместить свой подарок", done: db.posted },
      { key: "invited", emoji: "👯", label: "Пригласить друга", done: db.invited || invited },
      { key: "tour", emoji: "🎓", label: "Пройти обучение (гид)", done: tourDone },
      { key: "received", emoji: "📥", label: "Получить первый подарок", done: db.received },
      { key: "reviewed", emoji: "💌", label: "Оставить первый отзыв", done: db.reviewed },
      { key: "gifted", emoji: "🤝", label: "Вручить свой подарок", done: db.gifted },
    ],
  });

  // Дальнейшие ступени считаются по реальным счётчикам (нужен stats).
  if (stats) {
    // Ступень 2 — активный даритель (многие задачи дают реальный XP).
    stages.push({
      id: "active_giver",
      emoji: "💝",
      title: "Активный даритель",
      subtitle: "Дари и помогай чаще",
      tasks: [
        goal("giver_5", "💝", "Подарить 5 подарков", stats.gifted, 5, 30),
        goal("receiver_5", "🌸", "Получить 5 подарков", stats.received, 5, 20),
        goal("level_2", "✨", "Достичь 2 уровня", stats.level, 2, 25),
        goal("ref_3", "👯", "Пригласить 3 друзей", stats.referrals, 3),
      ],
    });

    // Ступень 3 — душа сообщества (амбициознее).
    stages.push({
      id: "community_soul",
      emoji: "🌟",
      title: "Душа сообщества",
      subtitle: "Ты — опора «Подари»",
      tasks: [
        goal("ref_5", "🤗", "Пригласить 5 друзей", stats.referrals, 5),
        goal("giver_10", "🎁", "Подарить 10 подарков", stats.gifted, 10),
        goal("receiver_10", "🌷", "Получить 10 подарков", stats.received, 10),
        goal("level_3", "🚀", "Достичь 3 уровня", stats.level, 3),
      ],
    });
  }

  return stages;
}

export const isStageDone = (s: Stage) => s.tasks.every((t) => t.done);

/** Единое окно прогресса: ступени открываются одна за другой.
 *  Первая — «Твои первые шаги», затем «Активный даритель», «Душа сообщества». */
export function Journey({ stats }: { stats: JourneyStats | null }) {
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

  const stages = db ? buildStages(db, tourDone, invitedLocal, stats) : [];

  // Салют, когда ступень полностью пройдена (один раз на ступень).
  useEffect(() => {
    if (!stages.length || typeof localStorage === "undefined") return;
    const doneIds = stages.filter(isStageDone).map((s) => s.id);
    let celebrated: string[] | null = null;
    try {
      const raw = localStorage.getItem(CELEBRATED_STAGES_KEY);
      celebrated = raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      celebrated = null;
    }
    if (celebrated === null) {
      try {
        localStorage.setItem(CELEBRATED_STAGES_KEY, JSON.stringify(doneIds));
      } catch {
        /* noop */
      }
      return;
    }
    const newly = doneIds.filter((id) => !celebrated!.includes(id));
    if (newly.length) {
      confetti({ particleCount: 160, spread: 90, origin: { y: 0.4 }, scalar: 1.15 });
      haptic("success");
      for (const id of newly) {
        const st = stages.find((s) => s.id === id);
        if (st) {
          toast.success(`🎉 Ступень пройдена: ${st.emoji} ${st.title}!`, {
            description: "Открылась следующая ступень пути 💚",
          });
        }
      }
      try {
        localStorage.setItem(CELEBRATED_STAGES_KEY, JSON.stringify([...celebrated, ...newly]));
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, tourDone, invitedLocal, stats]);

  if (!db) return null;

  const currentIndex = stages.findIndex((s) => !isStageDone(s));
  const allDone = currentIndex === -1 && (!!stats); // все известные ступени пройдены
  const totalStages = stats ? 3 : stages.length;
  const currentStageNum = currentIndex === -1 ? totalStages : currentIndex + 1;

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
          <h2 className="text-lg font-semibold tracking-tight">🌱 Мой путь</h2>
          <span className="shrink-0 rounded-full bg-background px-2.5 py-0.5 text-xs font-semibold text-foreground">
            {allDone ? "пройден" : `Ступень ${currentStageNum} из ${totalStages}`}
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${
            collapsed ? "" : "rotate-180"
          }`}
        />
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-2.5">
          {allDone && (
            <div className="rounded-2xl border border-mint/50 bg-background/60 p-4 text-center">
              <p className="text-base font-semibold">🎉 Все ступени пройдены!</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ты — настоящая душа «Подари». Скоро добавим новые цели и рейтинг ✨
              </p>
            </div>
          )}

          {stages.map((stage, i) => {
            const done = isStageDone(stage);
            const isCurrent = i === currentIndex;
            const isLockedNext = currentIndex !== -1 && i === currentIndex + 1;

            // Прошлые (пройденные) ступени — компактная свёрнутая строка.
            if (done && !isCurrent) {
              return (
                <div
                  key={stage.id}
                  className="flex items-center gap-2.5 rounded-2xl bg-background/50 px-3 py-2.5"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">
                    {stage.emoji} {stage.title} — пройдено
                  </span>
                </div>
              );
            }

            // Следующая (ещё закрытая) ступень — тизер.
            if (isLockedNext) {
              return (
                <div
                  key={stage.id}
                  className="flex items-center gap-2.5 rounded-2xl border border-dashed border-muted-foreground/30 bg-background/40 px-3 py-2.5"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Дальше: {stage.emoji} <b className="font-medium">{stage.title}</b> — откроется,
                    когда завершишь текущую ступень
                  </span>
                </div>
              );
            }

            // Текущая активная ступень — раскрытая, с задачами.
            if (isCurrent) {
              const doneCount = stage.tasks.filter((t) => t.done).length;
              const pct = Math.round((doneCount / stage.tasks.length) * 100);
              return (
                <div key={stage.id} className="rounded-2xl bg-background/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[15px] font-semibold">
                        {stage.emoji} {stage.title}
                      </p>
                      <p className="text-xs text-muted-foreground">{stage.subtitle}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-mint/40 px-2.5 py-0.5 text-xs font-semibold">
                      {doneCount}/{stage.tasks.length}
                    </span>
                  </div>

                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {stage.tasks.map((t) => (
                      <li
                        key={t.key}
                        className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm ${
                          t.done ? "bg-background/50" : "bg-background"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                            t.done ? "bg-emerald-500 text-white" : "border border-muted-foreground/40"
                          }`}
                        >
                          {t.done && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span
                          className={`flex-1 ${
                            t.done ? "text-muted-foreground line-through" : "font-medium"
                          }`}
                        >
                          {t.emoji} {t.label}
                        </span>
                        {!t.done && t.target && t.target > 1 && (
                          <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                            {Math.min(t.value ?? 0, t.target)}/{t.target}
                          </span>
                        )}
                        {!t.done && t.xp ? (
                          <span className="shrink-0 rounded-full bg-mint/40 px-1.5 py-0.5 text-[10px] font-semibold">
                            +{t.xp} XP
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>

                  {stage.id === "first_steps" && !tourDone && (
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
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </section>
  );
}
