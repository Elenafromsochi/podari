import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { Lock, Check } from "lucide-react";
import { ACHIEVEMENT_META, syncAndGetAchievements, type AchievementRow } from "@/lib/cozy.functions";

export function useAchievements() {
  const fn = useServerFn(syncAndGetAchievements);
  const [items, setItems] = useState<AchievementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fn();
        if (!mounted) return;
        setItems(res.items);
        // Поздравляем за свежевыданные
        if (res.newly_granted.length > 0) {
          const totalXp = res.newly_granted.reduce((s, n) => s + n.xp_granted, 0);
          confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
          for (const g of res.newly_granted) {
            const meta = ACHIEVEMENT_META[g.code];
            if (!meta) continue;
            toast.success(
              g.xp_granted > 0
                ? `${meta.emoji} ${meta.title} • +${g.xp_granted} XP`
                : `${meta.emoji} ${meta.title}`,
              { description: meta.description },
            );
          }
          // Сводный тост, если выдано больше одного
          if (res.newly_granted.length > 1) {
            toast.success(`🏆 Новые достижения • +${totalXp} XP всего`);
          }
          // Перезагружаем профиль чтобы обновились XP/уровень
          window.dispatchEvent(new CustomEvent("cozy:profile-changed"));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [fn]);

  return { items, loading };
}

type Props = { variant?: "preview" | "full" };

export function Achievements({ variant = "full" }: Props) {
  const { items, loading } = useAchievements();

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      // сначала открытые (по дате), потом по прогрессу
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      if (a.unlocked && b.unlocked) {
        return (b.awarded_at ?? "").localeCompare(a.awarded_at ?? "");
      }
      return b.progress / b.target - a.progress / a.target;
    });
  }, [items]);

  const unlockedCount = items.filter((i) => i.unlocked).length;

  if (variant === "preview") {
    const top = sorted.slice(0, 4);
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">🏆 Достижения</h3>
          <span className="text-xs text-muted-foreground">
            {unlockedCount}/{items.length}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {(loading ? Array.from({ length: 4 }).map(() => null) : top).map((it, idx) => {
            if (!it) {
              return (
                <div
                  key={idx}
                  className="aspect-square animate-pulse rounded-2xl bg-muted/40"
                />
              );
            }
            const meta = ACHIEVEMENT_META[it.code];
            if (!meta) return null;
            return (
              <div
                key={it.code}
                title={`${meta.title} — ${meta.description}`}
                className={`flex aspect-square flex-col items-center justify-center rounded-2xl p-2 text-center transition ${
                  it.unlocked
                    ? "bg-mint/40 shadow-sm"
                    : "bg-muted/30 opacity-60 grayscale"
                }`}
              >
                <div className="text-2xl leading-none">{meta.emoji}</div>
                <div className="mt-1 line-clamp-2 text-[10px] font-medium leading-tight">
                  {meta.title}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // FULL
  const groups = sorted.reduce<Record<string, AchievementRow[]>>((acc, it) => {
    const meta = ACHIEVEMENT_META[it.code];
    if (!meta) return acc;
    (acc[meta.group] ??= []).push(it);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-mint/20 px-4 py-3 text-center">
        <div className="text-2xl font-semibold">
          {unlockedCount} <span className="text-base text-muted-foreground">/ {items.length}</span>
        </div>
        <div className="text-xs text-muted-foreground">открыто достижений</div>
      </div>

      {loading ? (
        <p className="rounded-md bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          Загружаем...
        </p>
      ) : (
        Object.entries(groups).map(([groupName, arr]) => (
          <section key={groupName}>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">{groupName}</h3>
            <ul className="space-y-2">
              {arr.map((it) => {
                const meta = ACHIEVEMENT_META[it.code];
                if (!meta) return null;
                return (
                  <li
                    key={it.code}
                    className={`flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition ${
                      it.unlocked ? "bg-card" : "bg-muted/20"
                    }`}
                  >
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${
                        it.unlocked ? "bg-mint/40" : "bg-muted grayscale"
                      }`}
                    >
                      {meta.emoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`truncate text-sm font-semibold ${it.unlocked ? "" : "text-muted-foreground"}`}>
                          {meta.title}
                        </p>
                        {it.unlocked ? (
                          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{meta.description}</p>
                      {!it.unlocked && it.target > 1 && (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary/60"
                            style={{
                              width: `${Math.min(100, (it.progress / it.target) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <div className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${
                      it.unlocked ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                    }`}>
                      {meta.xp > 0 ? `+${meta.xp} XP` : (it.unlocked ? "✓" : "🏅")}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
