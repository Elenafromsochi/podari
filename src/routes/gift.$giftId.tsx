import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPublicGift, claimGift, reofferGift, deleteGift } from "@/lib/cozy.functions";
import { shareGift } from "@/lib/share";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { LevelBadge } from "@/components/LevelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Stars } from "@/components/ui/stars";
import { haptic } from "@/lib/haptics";

export const Route = createFileRoute("/gift/$giftId")({
  component: GiftPage,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicGift = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  image_urls?: string[] | null;
  cost: number;
  condition?: number | null;
  quantity?: number | null;
  quantity_remaining?: number | null;
  status: string;
  owner_id: string | null;
  owner_name: string;
  owner_level: number;
};

function GiftPage() {
  const { giftId } = Route.useParams();
  const navigate = useNavigate();
  const getGift = useServerFn(getPublicGift);
  const claim = useServerFn(claimGift);
  const reoffer = useServerFn(reofferGift);
  const deleteFn = useServerFn(deleteGift);

  const [gift, setGift] = useState<PublicGift | null | undefined>(undefined);
  const [authed, setAuthed] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  // «Подарить снова»: показываем степпер количества и сохраняем заново.
  const [reofferQty, setReofferQty] = useState(3);
  const [reoffering, setReoffering] = useState(false);

  useEffect(() => {
    // Реферал из ссылки — чтобы при входе засчитался пригласившему.
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && UUID_RE.test(ref)) localStorage.setItem("cozygift_pending_ref", ref);
    } catch {
      /* noop */
    }
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session?.user);
      setMeId(data.session?.user?.id ?? null);
    });
    getGift({ data: { gift_id: giftId } })
      .then((g) => setGift(g as PublicGift | null))
      .catch(() => setGift(null));
  }, [giftId, getGift]);

  // Степпер «Подарить снова» по умолчанию = прежний тираж подарка.
  useEffect(() => {
    if (gift && (gift.quantity ?? 0) > 1) setReofferQty(gift.quantity as number);
  }, [gift?.id, gift?.quantity]);

  const word = (n: number) => (n === 1 ? "балл" : n < 5 ? "балла" : "баллов");
  const photos =
    gift?.image_urls && gift.image_urls.length > 0
      ? gift.image_urls.filter(Boolean)
      : gift?.image_url
        ? [gift.image_url]
        : [];

  const onGet = async () => {
    if (!gift) return;
    haptic("medium");
    if (!authed) {
      // Запоминаем подарок и уходим на вход; после входа вернёмся сюда.
      try {
        localStorage.setItem("cozygift_pending_gift", giftId);
      } catch {
        /* noop */
      }
      navigate({ to: "/" });
      return;
    }
    setBusy(true);
    try {
      try {
        localStorage.setItem("cozygift_last_claim_cost", String(gift.cost ?? 1));
      } catch {
        /* noop */
      }
      await claim({ data: { gift_id: giftId } });
      toast.success(`Заморожено ${gift.cost} ${word(gift.cost)} • Безопасная сделка 🔒`, {
        description: "Открываем чат с дарителем",
      });
      navigate({ to: "/chat/$giftId", params: { giftId } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("INSUFFICIENT_BALANCE"))
        toast.error("Недостаточно баллов", { description: "Подари что-нибудь, чтобы заработать" });
      else if (msg.includes("ALREADY_TAKEN"))
        toast.error("Подарок уже забрали", { description: "Загляни в ленту — там много других 💚" });
      else if (msg.includes("OWN_GIFT"))
        toast.error("Это твой подарок", { description: "Своё забрать нельзя 🙂" });
      else toast.error("Не получилось забрать подарок", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const doReoffer = async () => {
    if (!gift) return;
    haptic("medium");
    setReoffering(true);
    try {
      await reoffer({ data: { gift_id: giftId, quantity: reofferQty } });
      toast.success("Подарок снова доступен 🎁", {
        description: `Тираж: ${reofferQty} — описание сохранено`,
      });
      // Перечитываем подарок, чтобы обновился статус и остаток.
      const g = await getGift({ data: { gift_id: giftId } });
      setGift(g as PublicGift | null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Не удалось повторить подарок", { description: msg });
    } finally {
      setReoffering(false);
    }
  };

  const doDelete = async () => {
    if (!gift) return;
    if (typeof window !== "undefined" && !window.confirm(`Удалить подарок «${gift.title}»? Это нельзя отменить.`)) return;
    try {
      await deleteFn({ data: { id: giftId } });
      toast.success("Подарок удалён");
      navigate({ to: "/" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        msg.includes("GIFT_IN_DEAL") ? "Нельзя удалить: подарок уже в сделке" : "Не удалось удалить",
        { description: msg.includes("GIFT_IN_DEAL") ? undefined : msg },
      );
    }
  };

  const isOwner = !!meId && gift?.owner_id === meId;
  const canEditOwn = isOwner && gift?.status === "available";
  // «Подарить снова» имеет смысл, когда экземпляры кончились (не available):
  // у многоразового (тираж > 1) или у любого уже подаренного.
  const canReoffer =
    isOwner &&
    !!gift &&
    gift.status !== "available" &&
    ((gift.quantity ?? 1) > 1 || gift.status === "gifted");

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-md bg-background px-5 pb-10 pt-5">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> На главную
      </Link>

      {gift === undefined ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-6 w-2/3 rounded-lg" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : gift === null ? (
        <div className="mt-10 rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Подарок не найден или уже снят с публикации 🌿
        </div>
      ) : (
        <div className="mt-4">
          {photos.length > 0 ? (
            <button
              type="button"
              onClick={() => setLightbox(true)}
              className="relative block w-full overflow-hidden rounded-2xl"
              aria-label="Посмотреть фото"
            >
              <img src={photos[0]} alt={gift.title} className="max-h-80 w-full object-cover" />
              {photos.length > 1 && (
                <span className="absolute bottom-2 right-2 rounded-md bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">
                  📷 {photos.length}
                </span>
              )}
            </button>
          ) : (
            <div className="flex h-56 w-full items-center justify-center rounded-2xl bg-muted text-6xl">
              🎁
            </div>
          )}

          <div className="mt-4 flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold leading-tight">{gift.title}</h1>
            <span className="shrink-0 rounded-xl bg-mint/70 px-3 py-1 text-sm font-semibold text-mint-foreground">
              {gift.cost} {word(gift.cost)}
            </span>
          </div>

          {gift.condition ? (
            <div className="mt-1 text-base leading-none" title={`Состояние: ${gift.condition} из 5`}>
              <Stars value={gift.condition} />
            </div>
          ) : null}

          {(gift.quantity ?? 1) > 1 &&
          gift.status === "available" &&
          typeof gift.quantity_remaining === "number" ? (
            <div className="mt-2 inline-block rounded-lg bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-700">
              🔁 осталось {gift.quantity_remaining} из {gift.quantity}
            </div>
          ) : null}

          {gift.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{gift.description}</p>
          )}

          {gift.owner_id && (
            <Link
              to="/user/$userId"
              params={{ userId: gift.owner_id }}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 text-sm shadow-sm transition active:scale-[0.98]"
            >
              <span className="text-muted-foreground">Дарит</span>
              <span className="font-semibold">{gift.owner_name}</span>
              <LevelBadge level={gift.owner_level} />
            </Link>
          )}

          {/* Поделиться (всем) + редактировать/удалить (владельцу) */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => shareGift(giftId, gift.title)}
              className="inline-flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium shadow-sm transition active:scale-[0.98] hover:bg-accent"
            >
              📤 Поделиться
            </button>
            {canEditOwn && (
              <>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/gift/$giftId/edit", params: { giftId } })}
                  className="inline-flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium shadow-sm transition active:scale-[0.98] hover:bg-accent"
                >
                  ✏️ Редактировать
                </button>
                <button
                  type="button"
                  onClick={doDelete}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-card px-3 py-2 text-sm font-medium text-destructive shadow-sm transition active:scale-[0.98] hover:bg-destructive/10"
                >
                  🗑 Удалить
                </button>
              </>
            )}
          </div>

          <div className="mt-6">
            {canReoffer ? (
              <div className="rounded-2xl border bg-card p-4 shadow-sm">
                <p className="text-sm font-medium">Все экземпляры разобрали 🎉</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Подарить снова? Укажи количество — описание сохранится.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Количество:</span>
                  <button
                    type="button"
                    onClick={() => setReofferQty((q) => Math.max(1, q - 1))}
                    aria-label="Меньше"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border text-lg leading-none transition active:scale-95"
                  >
                    −
                  </button>
                  <span className="min-w-[2rem] text-center text-base font-semibold">{reofferQty}</span>
                  <button
                    type="button"
                    onClick={() => setReofferQty((q) => Math.min(99, q + 1))}
                    aria-label="Больше"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border text-lg leading-none transition active:scale-95"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={doReoffer}
                  disabled={reoffering}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground shadow-sm transition active:scale-[0.98] hover:bg-primary/90 disabled:opacity-60"
                >
                  {reoffering ? "Минутку…" : "🔁 Подарить снова"}
                </button>
              </div>
            ) : gift.status !== "available" ? (
              <div className="rounded-2xl bg-muted/60 px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                Этот подарок уже разобрали 🌷 — загляни в ленту, там много других
              </div>
            ) : (
              <button
                type="button"
                onClick={onGet}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 text-base font-semibold text-primary-foreground shadow-sm transition active:scale-[0.98] hover:bg-primary/90 disabled:opacity-60"
              >
                {busy
                  ? "Минутку…"
                  : authed
                    ? `🎁 Получить за ${gift.cost} ${word(gift.cost)}`
                    : "Авторизоваться и получить подарок"}
              </button>
            )}
            {!authed && gift.status === "available" && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Вход в один тап через Telegram — и подарок твой 💚
              </p>
            )}
          </div>
        </div>
      )}

      {lightbox && photos.length > 0 && (
        <PhotoLightbox photos={photos} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}
