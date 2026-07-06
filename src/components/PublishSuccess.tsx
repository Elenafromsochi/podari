import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Gift as GiftIcon, HandHeart, Sparkles } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { supabase } from "@/integrations/supabase/client";
import { getPublicGift, deleteGift } from "@/lib/cozy.functions";
import { shareGift } from "@/lib/share";
import { ItemCard } from "@/components/ItemCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  /** Id только что опубликованного подарка — показываем его карточку-превью. */
  giftId: string;
  onGiveAnother: () => void;
  onReceive: () => void;
  onHome: () => void;
}

type GiftPreview = {
  title: string;
  description: string | null;
  cost: number;
  condition: number | null;
  image_url: string | null;
  image_urls?: string[] | null;
  city?: string | null;
  is_online?: boolean | null;
  status?: string | null;
};

function giftsWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "подарок";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "подарка";
  return "подарков";
}

export function PublishSuccess({ balance, giftId, onGiveAnother, onReceive, onHome }: Props) {
  const title = useMemo(() => pickRandom(PUBLISH_THANKS_TITLES), []);
  const desc = useMemo(() => pickRandom(PUBLISH_THANKS_DESCRIPTIONS), []);
  const randomHint = useMemo(() => pickRandom(BALANCE_HINTS), []);

  // Карточка-превью опубликованного подарка + счётчик «какой это по счёту».
  const getGift = useServerFn(getPublicGift);
  const [gift, setGift] = useState<GiftPreview | null>(null);
  const [count, setCount] = useState<number | null>(null);

  // Обычные действия карточки: поделиться / редактировать / удалить.
  const deleteFn = useServerFn(deleteGift);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteFn({ data: { id: giftId } });
      haptic("success");
      toast.success("Подарок удалён");
      setConfirmDelete(false);
      onHome();
    } catch (e) {
      toast.error("Не удалось удалить", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    let alive = true;
    getGift({ data: { gift_id: giftId } })
      .then((g) => {
        if (alive && g) setGift(g as unknown as GiftPreview);
      })
      .catch(() => {});
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      supabase
        .from("gifts")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", uid)
        .then(({ count: c }) => {
          if (alive) setCount(c ?? null);
        });
    });
    return () => {
      alive = false;
    };
  }, [giftId, getGift]);

  const cover =
    (gift?.image_urls && gift.image_urls[0]) || gift?.image_url || null;

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

        {/* Счётчик: какой это подарок по счёту у пользователя */}
        {count != null && count > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-mint/40 px-3 py-1 text-sm font-medium text-foreground">
            🎁 Это твой {count}-й подарок
          </p>
        )}

        {/* Превью карточки — та же единая карточка, что и во всём приложении */}
        {gift && (
          <div className="mt-4">
            <ItemCard
              image={cover}
              title={gift.title}
              description={gift.description}
              cost={gift.cost}
              condition={gift.condition}
              city={gift.city}
              isOnline={gift.is_online}
              onShare={() => shareGift(giftId, gift?.title)}
              footer={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    to="/gift/$giftId/edit"
                    params={{ giftId }}
                    className="inline-flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium shadow-sm transition active:scale-[0.98] hover:bg-accent"
                  >
                    ✏️ Редактировать
                  </Link>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-card px-3 py-2 text-sm font-medium text-destructive shadow-sm transition active:scale-[0.98] hover:bg-destructive/10"
                  >
                    🗑 Удалить
                  </button>
                </div>
              }
            />
            {gift.status === "hidden" ? (
              <p className="mt-2 rounded-2xl border border-primary/30 bg-primary/10 px-3 py-2 text-center text-[12px] font-medium text-foreground">
                🔒 Личный подарок — его нет в общей ленте. Нажми «Поделиться» и отправь
                ссылку тому, кому даришь: получить сможет только он.
              </p>
            ) : (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Так твой подарок видят другие ✨
              </p>
            )}
          </div>
        )}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить подарок?</AlertDialogTitle>
              <AlertDialogDescription>
                Подарок исчезнет из ленты. Это действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={doDelete} disabled={deleting}>
                {deleting ? "Удаляем…" : "Удалить"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="mt-5 rounded-2xl bg-mint/40 p-4 text-sm leading-relaxed text-foreground/90">
          {hint}
        </div>

        <div className="mt-6 space-y-3">
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
