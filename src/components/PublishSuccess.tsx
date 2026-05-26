import { useMemo } from "react";
import { Gift as GiftIcon, HandHeart, Sparkles } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { pickRandom, PUBLISH_THANKS_TITLES, PUBLISH_THANKS_DESCRIPTIONS } from "@/lib/random-copy";

const BALANCE_HINTS = [
  "Чтобы баланс был в потоке — забери чей-то подарок. Дарить и получать одинаково важно 💚",
  "Подарок улетел — теперь твоя очередь получать. Загляни в ленту, там кто-то ждёт именно тебя ✨",
  "Хочешь поддержать круговорот? Возьми подарок у другого — так баланс остаётся живым 🌿",
  "Можешь разместить ещё один подарок — или забрать что-то у другого. Выбор за тобой 💫",
  "Баланс — это поток: подарил → забери. Так мир добрых вещей крутится дальше 🎁",
] as const;

interface Props {
  onGiveAnother: () => void;
  onReceive: () => void;
  onHome: () => void;
}

export function PublishSuccess({ onGiveAnother, onReceive, onHome }: Props) {
  const title = useMemo(() => pickRandom(PUBLISH_THANKS_TITLES), []);
  const desc = useMemo(() => pickRandom(PUBLISH_THANKS_DESCRIPTIONS), []);
  const hint = useMemo(() => pickRandom(BALANCE_HINTS), []);

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
          <button
            type="button"
            onClick={() => {
              haptic("medium");
              onReceive();
            }}
            className="flex w-full items-center gap-3 rounded-2xl bg-mint px-5 py-4 text-left text-mint-foreground shadow-sm transition active:scale-[0.98]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
              <GiftIcon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-base font-semibold leading-tight">🎁 Забрать подарок</span>
              <span className="block text-xs opacity-75">поддержать круговорот</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              haptic("medium");
              onGiveAnother();
            }}
            className="flex w-full items-center gap-3 rounded-2xl bg-lavender px-5 py-4 text-left text-lavender-foreground shadow-sm transition active:scale-[0.98]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
              <HandHeart className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-base font-semibold leading-tight">✨ Подарить ещё один</span>
              <span className="block text-xs opacity-75">если хочется делиться дальше</span>
            </span>
          </button>

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
