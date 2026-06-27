import { LEVEL_UP_WAYS, xpRemainingToLevel } from "@/lib/levels";

interface Props {
  /** Название подарка, который человек хотел получить. */
  giftTitle: string;
  /** Уровень, с которого подарок открывается. */
  requiredLevel: number;
  userLevel: number;
  userXp: number;
  /** Пригласить друга (поделиться ссылкой + засчитать шаг). */
  onInvite: () => void;
  /** Перейти к дарению (быстрый способ поднять уровень). */
  onGive: () => void;
  onClose: () => void;
}

/**
 * Подсказка, когда подарок недоступен по уровню. Не тупик: объясняем, с какого
 * уровня откроется, сколько осталось и как уровень поднять — проще всего позвать
 * друзей. (Нехватку баллов при достаточном уровне ловит отдельное окно.)
 */
export function LevelGateModal({
  giftTitle,
  requiredLevel,
  userLevel,
  userXp,
  onInvite,
  onGive,
  onClose,
}: Props) {
  const remaining = xpRemainingToLevel(userXp, requiredLevel);
  const friends = Math.max(1, Math.ceil(remaining / 50));

  return (
    <div className="fixed inset-0 z-[97] flex items-end justify-center bg-black/50 p-0 animate-fade-in sm:items-center sm:p-6">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-background p-5 shadow-xl animate-scale-in sm:rounded-3xl">
        <h3 className="text-lg font-semibold">🔒 Откроется на {requiredLevel} уровне</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          «{giftTitle}» можно получить с <b>{requiredLevel}</b> уровня. Твой сейчас — <b>{userLevel}</b>.
          {remaining > 0 && (
            <>
              {" "}До него осталось <b>~{remaining} XP</b> — это примерно {friends}{" "}
              {friends === 1 ? "приглашённый друг" : friends < 5 ? "приглашённых друга" : "приглашённых друзей"}.
            </>
          )}
        </p>

        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">Как поднять уровень:</p>
          {LEVEL_UP_WAYS.map((w) => (
            <div key={w.label} className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2">
              <span className="text-lg leading-none">{w.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{w.label}</span>
                  <span className="shrink-0 rounded-lg bg-mint/70 px-2 py-0.5 text-[11px] font-semibold text-mint-foreground">
                    +{w.xp} XP
                  </span>
                </div>
                <p className="text-[11px] leading-tight text-muted-foreground">{w.note}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={onInvite}
            className="w-full rounded-2xl bg-mint px-5 py-3 text-base font-semibold text-mint-foreground transition active:scale-[0.98] hover:bg-mint/90"
          >
            🤝 Пригласить друга
          </button>
          <button
            onClick={onGive}
            className="w-full rounded-2xl bg-lavender px-5 py-3 text-base font-semibold text-lavender-foreground transition active:scale-[0.98] hover:bg-lavender/90"
          >
            🎁 Подарить подарок
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-2xl border px-5 py-3 text-sm text-muted-foreground transition hover:bg-accent"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}
