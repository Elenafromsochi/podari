import { useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getUserJourney } from "@/lib/cozy.functions";
import { buildStages, isStageDone, type DbSteps } from "@/components/Journey";
import type { JourneyStats } from "@/components/Achievements";

/**
 * «Путь» пользователя только для чтения — для публичного профиля.
 * Та же структура ступеней, что и в личном Journey, но без интерактива,
 * localStorage и шага «гид» (он хранится локально у каждого устройства).
 */
export function UserJourney({ userId }: { userId: string }) {
  const fn = useServerFn(getUserJourney);
  const [data, setData] = useState<{ db: DbSteps; stats: JourneyStats } | null>(null);

  useEffect(() => {
    let alive = true;
    fn({ data: { user_id: userId } })
      .then((r) => {
        if (alive) setData(r as { db: DbSteps; stats: JourneyStats });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fn, userId]);

  if (!data) return null;

  const stages = buildStages(data.db, false, data.db.invited, data.stats).map((s) =>
    s.id === "first_steps"
      ? { ...s, tasks: s.tasks.filter((t) => t.key !== "tour") }
      : s,
  );
  const currentIndex = stages.findIndex((s) => !isStageDone(s));
  const totalStages = 3;
  const currentStageNum = currentIndex === -1 ? totalStages : currentIndex + 1;
  const allDone = currentIndex === -1;

  return (
    <section className="rounded-3xl border border-mint/50 bg-mint/15 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">🌱 Путь</h2>
        <span className="shrink-0 rounded-full bg-background px-2.5 py-0.5 text-xs font-semibold text-foreground">
          {allDone ? "пройден" : `Ступень ${currentStageNum} из ${totalStages}`}
        </span>
      </div>

      <div className="mt-3 space-y-2.5">
        {stages.map((stage, i) => {
          const done = isStageDone(stage);
          const isCurrent = i === currentIndex;
          const isLockedNext = currentIndex !== -1 && i === currentIndex + 1;

          if (done && !isCurrent) {
            return (
              <div
                key={stage.id}
                className="flex items-center gap-2.5 rounded-2xl bg-background/50 px-3 py-2.5"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  {stage.emoji} {stage.title} — пройдено
                </span>
              </div>
            );
          }

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
                  Дальше: {stage.emoji} <b className="font-medium">{stage.title}</b>
                </span>
              </div>
            );
          }

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
                    className="h-full rounded-full bg-primary transition-all"
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
                          t.done ? "bg-primary text-white" : "border border-muted-foreground/40"
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
                    </li>
                  ))}
                </ul>
              </div>
            );
          }

          return null;
        })}
      </div>
    </section>
  );
}
