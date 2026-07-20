import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPublicWish, fulfillWish } from "@/lib/wishes.functions";
import { shareWish } from "@/lib/share";
import {
  startTelegramLogin,
  pollTelegramLogin,
  completeTelegramLogin,
} from "@/lib/telegram-auth.functions";
import { setTelegramSession } from "@/lib/auth-state";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { LevelBadge } from "@/components/LevelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { haptic } from "@/lib/haptics";

export const Route = createFileRoute("/wish/$wishId")({
  component: WishPage,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicWish = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  image_urls?: string[] | null;
  cost?: number;
  status: string;
  owner_id: string | null;
  owner_name: string;
  owner_level: number;
  link?: string | null;
};

function WishPage() {
  const { wishId } = Route.useParams();
  const navigate = useNavigate();
  const getWish = useServerFn(getPublicWish);
  const fulfill = useServerFn(fulfillWish);

  const [wish, setWish] = useState<PublicWish | null | undefined>(undefined);
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);

  // Вход через Telegram прямо со страницы желания — тот же приём, что и
  // на странице подарка: ссылку на бота готовим заранее, чтобы первый тап
  // сразу открывал Telegram (иначе Safari блокирует открытие после запроса).
  const startTg = useServerFn(startTelegramLogin);
  const pollTg = useServerFn(pollTelegramLogin);
  const completeTg = useServerFn(completeTelegramLogin);
  const [tgPhase, setTgPhase] = useState<"idle" | "waiting" | "signing_in">("idle");
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null);
  const [tgNonce, setTgNonce] = useState<string | null>(null);
  const [tgStatus, setTgStatus] = useState("");
  const tgPollingRef = useRef<number | null>(null);

  useEffect(() => {
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
    getWish({ data: { wish_id: wishId } })
      .then((w) => setWish(w as PublicWish | null))
      .catch(() => setWish(null));
  }, [wishId, getWish]);

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
        } else if (r.status === "opened") {
          setTgStatus("Ты открыл бота — теперь нажми ✅ Это я");
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
      toast.success(res.is_new ? "Добро пожаловать в «Подари» 💚" : "С возвращением 💚");
      setTgPhase("idle");
      // Раз человек и пришёл исполнить это желание — сразу откликаемся.
      await fulfillNow();
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
    setTgStatus("Открой бота, нажми Start, затем ✅ Это я");
    if (tgNonce) startTgPolling(tgNonce);
  };

  const photos =
    wish?.image_urls && wish.image_urls.length > 0
      ? wish.image_urls.filter(Boolean)
      : wish?.image_url
        ? [wish.image_url]
        : [];

  const fulfillNow = async () => {
    if (!wish) return;
    setBusy(true);
    try {
      await fulfill({ data: { wish_id: wishId } });
      toast.success("Отклик отправлен 💫", {
        description: "Чат с автором желания открылся во вкладке «Чаты»",
      });
      navigate({ to: "/", search: { tab: "chats" } as never });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ALREADY_TAKEN"))
        toast.error("Желание уже исполняют", { description: "Загляни в ленту — там много других 💚" });
      else if (msg.includes("OWN_WISH"))
        toast.error("Это твоё желание", { description: "Своё исполнить нельзя 🙂" });
      else toast.error("Не получилось откликнуться", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const onFulfill = async () => {
    if (!wish) return;
    haptic("medium");
    if (!authed) {
      if (tgDeepLink) {
        onTapTelegram();
        return;
      }
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
        setTgStatus("Открой бота и нажми Start, затем ✅ Это я");
        startTgPolling(res.nonce);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Не удалось начать вход", { description: msg });
        setTgPhase("idle");
        setTgStatus("");
      }
      return;
    }
    await fulfillNow();
  };

  const isOwner = !!meId && wish?.owner_id === meId;
  const isHidden = wish?.status === "hidden";
  const isFulfillable = wish?.status === "open" || isHidden;

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-md bg-background px-5 pb-10 pt-5">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> На главную
      </Link>

      {wish === undefined ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-6 w-2/3 rounded-lg" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : wish === null ? (
        <div className="mt-10 rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Желание не найдено или уже снято с публикации 🌿
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
                    <img src={src} alt={wish.title} className="max-h-80 w-full object-cover" />
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
              ✨
            </div>
          )}

          <div className="mt-4 flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold leading-tight">{wish.title}</h1>
            {typeof wish.cost === "number" && (
              <span className="shrink-0 rounded-xl bg-mint/70 px-3 py-1 text-sm font-semibold text-mint-foreground">
                {wish.cost} {wish.cost === 1 ? "балл" : wish.cost < 5 ? "балла" : "баллов"}
              </span>
            )}
          </div>

          {wish.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
              {wish.description}
            </p>
          )}

          {wish.link && (
            <a
              href={wish.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              🔗 Ссылка на пример
            </a>
          )}

          {wish.owner_id && (
            <Link
              to="/user/$userId"
              params={{ userId: wish.owner_id }}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 text-sm shadow-sm transition active:scale-[0.98]"
            >
              <span className="text-muted-foreground">Загадал(а)</span>
              <span className="font-semibold">{wish.owner_name}</span>
              <LevelBadge level={wish.owner_level} />
            </Link>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => shareWish(wishId, wish.title)}
              className="inline-flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium shadow-sm transition active:scale-[0.98] hover:bg-accent"
            >
              📤 Поделиться
            </button>
          </div>

          {isHidden && (
            <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-center text-sm font-medium text-foreground">
              🔒 Личное желание — он{isOwner ? " не виден" : " видно только"} в общей ленте
              {isOwner ? "" : " по этой ссылке"}. {isOwner ? "Отправь ссылку тому, кого просишь исполнить." : "Тебя и попросили его исполнить 💚"}
            </div>
          )}

          <div className="mt-6">
            {isFulfillable && !isOwner && (
              <p className="mb-3 text-center text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{wish.owner_name}</span> загадал(а)
                это желание — можешь исполнить?
              </p>
            )}
            {!isFulfillable ? (
              <div className="rounded-2xl bg-muted/60 px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                Это желание уже исполняют 🌷 — загляни в ленту, там много других
              </div>
            ) : isOwner ? (
              <div className="rounded-2xl bg-muted/60 px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                Это твоё желание — жди отклика от кого-нибудь 💫
              </div>
            ) : authed ? (
              <button
                type="button"
                onClick={onFulfill}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mint px-4 py-3.5 text-base font-semibold text-mint-foreground shadow-sm transition active:scale-[0.98] hover:bg-mint/90 disabled:opacity-60"
              >
                {busy ? "Минутку…" : "🤝 Исполнить желание"}
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
                  : "Авторизоваться и исполнить"}
              </a>
            ) : (
              <button
                type="button"
                onClick={onFulfill}
                disabled={tgPhase !== "idle"}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mint px-4 py-3.5 text-base font-semibold text-mint-foreground shadow-sm transition active:scale-[0.98] hover:bg-mint/90 disabled:opacity-60"
              >
                {tgPhase !== "idle" ? "Минутку…" : "Авторизоваться и исполнить"}
              </button>
            )}
            {!authed && isFulfillable && !isOwner && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {tgPhase === "idle" ? "Вход в один тап через Telegram 💚" : tgStatus}
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
