import { useMemo } from "react";
import { Gift as GiftIcon, HandHeart, Sparkles, Eye } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { pickRandom, PUBLISH_THANKS_TITLES, PUBLISH_THANKS_DESCRIPTIONS } from "@/lib/random-copy";

const BALANCE_HINTS = [
  "Чтобы баланс был в потоке — забери чей-то подарок. Дарить и получать одинаково важно 💚",
  "Подарок улетел — теперь твоя очередь получать. Загляни в ленту, там кто-то ждёт именно тебя ✨",
  "Хочешь поддержать круговорот? Возьми подарок у другого — так баланс остаётся живым 🌿",
  "Можешь разместить ещё один подарок — или забрать что-то у другого. Выбор за тобой 💫",
  "Баланс — это поток: подарил → забери. Так мир добрых вещей крутится дальше 🎁",
] as const;

// Сколько баллов начисляется за один выложенный подарок
const REWARD_PER_GIFT = 0.2;
// Сколько баллов нужно, чтобы выбрать подарок себе
const COST_TO_RECEIVE = 1;

interface Props {
  /** Текущий баланс пользователя (в баллах) */
  balance: number;
  onGiveAnother: () => void;
  onReceive: () => void;
  onHome: () => void;
  /** Открыть карточку только что опубликованного подарка (со всеми действиями). */
  onViewGift?: () => void;
}

function giftsWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "подарок";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "подарка";
  return "подарков";
}

export function PublishSuccess({ balance, onGiveAnother, onReceive, onHome, onViewGift }: Props) {
  const title = useMemo(() => pickRandom(PUBLISH_THANKS_TITLES), []);
  const desc = useMemo(() => pickRandom(PUBLISH_THANKS_DESCRIPTIONS), []);
  const randomHint = useMemo(() => pickRandom(BALANCE_HINTS), []);

  // Хватает ли баллов, чтобы выбрать подарок себе
  const canReceive = balance >= COST_TO_RECEIVE;
  // Сколько ещё подарков выложить до 1 балла
  const giftsToGo = Math.max(
    0,
    Math.ceil((COST_TO_RECEIVE - balance) / REWARD_PER_GIFT - 1e-9),
  );

  const hint = canReceive
    ? randomHint
    : `За каждый выложенный подарок начисляется +${REWARD_PER_GIFT} балла. ` +
      `Чтобы выбрать подарок себе, нужен 1 балл — выложи ещё ${giftsToGo} ${giftsWord(giftsToGo)}, ` +
      `и сможешь выбрать любой подарок 💚`;

  const giveBtn = (
    <button
      type="button"
      onClick={() => {
        haptic("medium");
        onGiveAnother();
      }}
      className="flex w-full items-center gap-3 rounded-2xl bg-mint px-5 py-4 text-left text-mint-foreground shadow-sm transition active:scale-[0.98]"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
        <HandHeart className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-base font-semibold leading-tight">
          ✨ Подарить ещё один
        </span>
        <span className="block text-xs opacity-75">
          {canReceive
            ? "если хочется делиться дальше"
            : `+${REWARD_PER_GIFT} балла — на шаг ближе к подарку`}
        </span>
      </span>
    </button>
  );

  const receiveBtn = (
    <button
      type="button"
      onClick={() => {
        haptic("medium");
        onReceive();
      }}
      className={`flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left shadow-sm transition active:scale-[0.98] ${
        canReceive
          ? "bg-mint text-mint-foreground"
          : "bg-lavender text-lavender-foreground"
      }`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
        <GiftIcon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-base font-semibold leading-tight">
          🎁 Получить подарок
        </span>
        <span className="block text-xs opacity-75">
          {canReceive ? "поддержать круговорот" : "нужен 1 балл — пока посмотреть ленту"}
        </span>
      </span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-md px-5 py-10">
      <div className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-peach">
          <Sparkles className="h-7 w-7 text-peach-foreground" />
        </div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{desc}</p>

        <div className="mt-5 rounded-2xl bg-mint/40 p-4 text-sm leading-relaxed text-foreground/90">
          {hint}
        </div>

        <div className="mt-6 space-y-3">
          {/* Сразу даём открыть карточку опубликованного подарка — там все
              действия: посмотреть, редактировать, поделиться, удалить. */}
          {onViewGift && (
            <button
              type="button"
              onClick={() => {
                haptic("medium");
                onViewGift();
              }}
              className="flex w-full items-center gap-3 rounded-2xl bg-lavender px-5 py-4 text-left text-lavender-foreground shadow-sm transition active:scale-[0.98]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
                <Eye className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-base font-semibold leading-tight">
                  👀 Посмотреть мой подарок
                </span>
                <span className="block text-xs opacity-75">
                  карточка целиком: редактировать, поделиться, удалить
                </span>
              </span>
            </button>
          )}

          {/* Когда баллов не хватает — ведём дарить ещё; иначе — получать */}
          {canReceive ? (
            <>
              {receiveBtn}
              {giveBtn}
            </>
          ) : (
            <>
              {giveBtn}
              {receiveBtn}
            </>
          )}

          <button
            type="button"
            onClick={onHome}
            className="w-full rounded-2xl border px-5 py-3 text-sm text-muted-foreground transition hover:bg-accent"
          >
            На главную
          </button>
        </div>
      </div>
    </div>
  );
}
