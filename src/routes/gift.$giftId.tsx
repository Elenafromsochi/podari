import { createFileRoute, useNavigate, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPublicGift, claimGift, reofferGift, deleteGift } from "@/lib/cozy.functions";
import { shareGift } from "@/lib/share";
import {
  startTelegramLogin,
  pollTelegramLogin,
  completeTelegramLogin,
} from "@/lib/telegram-auth.functions";
import { setTelegramSession } from "@/lib/auth-state";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { CertificateBuilder } from "@/components/CertificateBuilder";
import { LevelBadge } from "@/components/LevelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Stars } from "@/components/ui/stars";
import { haptic } from "@/lib/haptics";
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
  is_certificate?: boolean | null;
  cert_expires_at?: string | null;
};

function GiftPage() {
  const { giftId } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.history.back();
    else navigate({ to: "/" });
  };
  const getGift = useServerFn(getPublicGift);
  const claim = useServerFn(claimGift);
  const reoffer = useServerFn(reofferGift);
  const deleteFn = useServerFn(deleteGift);

  const [gift, setGift] = useState<PublicGift | null | undefined>(undefined);
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  // «Подарить снова»: показываем степпер количества и сохраняем заново.
  const [reofferQty, setReofferQty] = useState(3);
  const [reoffering, setReoffering] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [certOpen, setCertOpen] = useState(false);

  // Вход через Telegram прямо со страницы подарка — без промежуточного
  // экрана входа. Ссылку на бота готовим заранее, чтобы первый тап по
  // «Авторизоваться и получить подарок» сразу открывал Telegram (иначе
  // Safari блокирует открытие окна после асинхронного запроса).
  const startTg = useServerFn(startTelegramLogin);
  const pollTg = useServerFn(pollTelegramLogin);
  const completeTg = useServerFn(completeTelegramLogin);
  const [tgPhase, setTgPhase] = useState<"idle" | "waiting" | "signing_in">("idle");
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null);
  const [tgNonce, setTgNonce] = useState<string | null>(null);
  const [tgStatus, setTgStatus] = useState("");
  const tgPollingRef = useRef<number | null>(null);

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
      setAuthChecked(true);
    });
    getGift({ data: { gift_id: giftId } })
      .then((g) => setGift(g as PublicGift | null))
      .catch(() => setGift(null));
  }, [giftId, getGift]);

  useEffect(() => {
    if (!authChecked || authed) return;
    let alive = true;
    (async () => {
      try {
        const referrer_id = (() => {
          try {
            return localStorage.getItem("cozygift_pending_ref");
          } catch {
            return null;
          }
        })();
        const res = await startTg({ data: { referrer_id } });
        if (!alive) return;
        setTgNonce(res.nonce);
        setTgDeepLink(res.deep_link);
      } catch {
        /* нет связи — кнопка-фолбэк подготовит ссылку по тапу */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, authed]);

  useEffect(() => {
    return () => {
      if (tgPollingRef.current) window.clearInterval(tgPollingRef.current);
    };
  }, []);

  const clearTgPolling = () => {
    if (tgPollingRef.current) {
      window.clearInterval(tgPollingRef.current);
      tgPollingRef.current = null;
    }
  };

  const startTgPolling = (nonce: string) => {
    clearTgPolling();
    const deadline = Date.now() + 5 * 60 * 1000;
    tgPollingRef.current = window.setInterval(async () => {
      if (Date.now() > deadline) {
        clearTgPolling();
        setTgStatus("Время вышло. Нажми ещё раз.");
        setTgPhase("idle");
        return;
      }
      try {
        const r = await pollTg({ data: { nonce } });
        if (r.status === "approved") {
          clearTgPolling();
          await finishTgSignIn(nonce);
        } else if (r.status === "rejected") {
          clearTgPolling();
          setTgStatus("Вход отклонён в боте. Нажми ещё раз.");
          setTgPhase("idle");
        } else if (r.status === "expired" || r.status === "not_found") {
          clearTgPolling();
          setTgStatus("Ссылка истекла. Нажми ещё раз.");
          setTgPhase("idle");
          setTgDeepLink(null);
          setTgNonce(null);
        } else {
          setTgStatus("Открой бота и нажми Start");
        }
      } catch {
        /* сетевой сбой — пробуем на следующем тике */
      }
    }, 1500);
  };

  const finishTgSignIn = async (nonce: string) => {
    setTgPhase("signing_in");
    setTgStatus("Входим…");
    try {
      const res = await completeTg({ data: { nonce } });
      await setTelegramSession(res.access_token, res.refresh_token);
      const { data } = await supabase.auth.getSession();
      setAuthed(true);
      setMeId(data.session?.user?.id ?? null);
      toast.success(
        res.is_new ? "Добро пожаловать в «Подари» 💚" : "С возвращением 💚",
      );
      setTgPhase("idle");
      // Раз человек и пришёл за этим подарком — сразу забираем его.
      await claimNow();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let text = "Не удалось войти";
      if (msg.includes("NONCE_EXPIRED")) text = "Ссылка истекла — нажми ещё раз";
      else if (msg.includes("NONCE_REJECTED")) text = "Вход отклонён в боте";
      else if (msg.includes("NOT_APPROVED")) text = "Сначала подтверди вход в боте";
      else if (msg.includes("NONCE_CONSUMED")) text = "Этот вход уже использован — начни заново";
      toast.error(text, { description: msg });
      setTgPhase("idle");
      setTgStatus("");
      setTgDeepLink(null);
      setTgNonce(null);
    }
  };

  const onTapTelegram = () => {
    haptic("medium");
    setTgPhase("waiting");
    setTgStatus("Открой бота и нажми Start");
    if (tgNonce) startTgPolling(tgNonce);
  };

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

  const claimNow = async () => {
    if (!gift) return;
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
        toast.error("Подарок уже забрали", {
          description: "Загляни в ленту — там много других 💚",
        });
      else if (msg.includes("OWN_GIFT"))
        toast.error("Это твой подарок", { description: "Своё забрать нельзя 🙂" });
      else toast.error("Не получилось забрать подарок", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const onGet = async () => {
    if (!gift) return;
    haptic("medium");
    if (!authed) {
      // Ссылку на бота уже подготовили заранее — просто открываем её и
      // ждём подтверждения, без ухода на отдельный экран входа.
      if (tgDeepLink) {
        onTapTelegram();
        return;
      }
      // Фолбэк, если ссылка не успела подготовиться (нет сети при загрузке).
      setTgPhase("waiting");
      setTgStatus("Готовим ссылку…");
      try {
        const referrer_id = (() => {
          try {
            return localStorage.getItem("cozygift_pending_ref");
          } catch {
            return null;
          }
        })();
        const res = await startTg({ data: { referrer_id } });
        setTgNonce(res.nonce);
        setTgDeepLink(res.deep_link);
        window.open(res.deep_link, "_blank", "noopener,noreferrer");
        setTgStatus("Открой бота и нажми Start");
        startTgPolling(res.nonce);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Не удалось начать вход", { description: msg });
        setTgPhase("idle");
        setTgStatus("");
      }
      return;
    }
    await claimNow();
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
    try {
      await deleteFn({ data: { id: giftId } });
      setConfirmDelete(false);
      toast.success("Подарок удалён");
      navigate({ to: "/" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        msg.includes("GIFT_IN_DEAL")
          ? "Нельзя удалить: подарок уже в сделке"
          : "Не удалось удалить",
        { description: msg.includes("GIFT_IN_DEAL") ? undefined : msg },
      );
    }
  };

  const isOwner = !!meId && gift?.owner_id === meId;
  const isHidden = gift?.status === "hidden";
  const isCertificate = !!gift?.is_certificate;
  const certExpired =
    !!gift?.cert_expires_at && new Date(gift.cert_expires_at).getTime() < Date.now();
  // Скрытый (личный) подарок получают так же, как обычный — только по ссылке.
  // Просроченный сертификат забрать нельзя.
  const isClaimable = (gift?.status === "available" || isHidden) && !certExpired;
  // Редактировать можно свободный/скрытый и забронированный (у последнего сервер
  // сам разрешит правку, только пока сделка «свежая» — нет сообщений в чате).
  const canEditOwn = isOwner && (isClaimable || gift?.status === "reserved");
  // «Подарить снова» имеет смысл, когда экземпляры кончились (не available):
  // у многоразового (тираж > 1) или у любого уже подаренного.
  const canReoffer =
    isOwner &&
    !!gift &&
    gift.status !== "available" &&
    ((gift.quantity ?? 1) > 1 || gift.status === "gifted");

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-md bg-background px-5 pb-10 pt-5">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>

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
            <div className="relative">
              <div
                className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const idx = Math.round(el.scrollLeft / el.clientWidth);
                  if (idx !== photoIdx) setPhotoIdx(idx);
                }}
              >
                {photos.map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setPhotoIdx(i);
                      setLightbox(true);
                    }}
                    className="w-full shrink-0 snap-center"
                    aria-label={`Фото ${i + 1} из ${photos.length}`}
                  >
                    <img src={src} alt={gift.title} className="max-h-80 w-full object-cover" />
                  </button>
                ))}
              </div>
              {photos.length > 1 && (
                <>
                  <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">
                    {photoIdx + 1}/{photos.length}
                  </span>
                  <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                    {photos.map((_, n) => (
                      <span
                        key={n}
                        className={`h-1.5 w-1.5 rounded-full transition ${
                          n === photoIdx ? "bg-white" : "bg-white/50"
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
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
            <div
              className="mt-1 text-base leading-none"
              title={`Состояние: ${gift.condition} из 5`}
            >
              <Stars value={gift.condition} />
            </div>
          ) : null}

          {gift.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
              {gift.description}
            </p>
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
              </>
            )}
          </div>

          {/* Сертификат из этого подарка — владельцу, пока подарок не в сделке */}
          {isOwner && (gift.status === "available" || isHidden) && (
            <button
              type="button"
              onClick={() => setCertOpen(true)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary transition active:scale-[0.98] hover:bg-primary/15"
            >
              🎟 Создать подарочный сертификат
            </button>
          )}

          {certOpen && (
            <CertificateBuilder
              giftId={giftId}
              giftTitle={gift.title}
              myName={gift.owner_name}
              onClose={() => setCertOpen(false)}
              onCreated={() => {
                setGift((g) => (g ? { ...g, status: "hidden", is_certificate: true } : g));
              }}
            />
          )}

          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить подарок?</AlertDialogTitle>
                <AlertDialogDescription>
                  Подарок «{gift.title}» исчезнет из ленты. Это действие нельзя отменить.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={doDelete}>Удалить</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

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
                  <span className="min-w-[2rem] text-center text-base font-semibold">
                    {reofferQty}
                  </span>
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
            ) : certExpired ? (
              <div className="rounded-2xl bg-muted/60 px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                🎟 Срок действия сертификата истёк
              </div>
            ) : !isClaimable ? (
              <div className="rounded-2xl bg-muted/60 px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                Этот подарок уже разобрали 🌷 — загляни в ленту, там много других
              </div>
            ) : (
              <>
                {isCertificate ? (
                  <div className="mb-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-center text-sm font-medium text-foreground">
                    🎟 Подарочный сертификат{" "}
                    {isOwner
                      ? "— отправь ссылку тому, кому даришь."
                      : "— он для тебя 💚 Активируй, и договоритесь о встрече."}
                  </div>
                ) : isHidden ? (
                  <div className="mb-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-center text-sm font-medium text-foreground">
                    🔒 Личный подарок — он{isOwner ? " не виден" : " виден только"} в общей ленте
                    {isOwner ? "" : " по этой ссылке"}. {isOwner ? "Отправь ссылку тому, кому даришь." : "Он для тебя 💚"}
                  </div>
                ) : null}
                {authed ? (
                  <button
                    type="button"
                    onClick={onGet}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mint px-4 py-3.5 text-base font-semibold text-mint-foreground shadow-sm transition active:scale-[0.98] hover:bg-mint/90 disabled:opacity-60"
                  >
                    {busy
                      ? "Минутку…"
                      : isCertificate
                        ? `🎟 Активировать за ${gift.cost} ${word(gift.cost)}`
                        : `🎁 Получить за ${gift.cost} ${word(gift.cost)}`}
                  </button>
                ) : tgDeepLink ? (
                  <a
                    href={tgDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onTapTelegram}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mint px-4 py-3.5 text-base font-semibold text-mint-foreground shadow-sm transition active:scale-[0.98] hover:bg-mint/90"
                  >
                    {tgPhase === "waiting" || tgPhase === "signing_in"
                      ? "Открыть Telegram ещё раз"
                      : isCertificate
                        ? "Войти и активировать сертификат"
                        : "Авторизоваться и получить подарок"}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={onGet}
                    disabled={tgPhase !== "idle"}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mint px-4 py-3.5 text-base font-semibold text-mint-foreground shadow-sm transition active:scale-[0.98] hover:bg-mint/90 disabled:opacity-60"
                  >
                    {tgPhase !== "idle"
                      ? "Минутку…"
                      : isCertificate
                        ? "Войти и активировать сертификат"
                        : "Авторизоваться и получить подарок"}
                  </button>
                )}
              </>
            )}
            {!authed && isClaimable && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {tgPhase === "idle"
                  ? "Вход в один тап через Telegram — и подарок твой 💚"
                  : tgStatus}
              </p>
            )}
          </div>
        </div>
      )}

      {lightbox && photos.length > 0 && (
        <PhotoLightbox photos={photos} startIndex={photoIdx} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}
