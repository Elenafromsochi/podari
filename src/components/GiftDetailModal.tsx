import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LevelBadge } from "@/components/LevelBadge";
import { Stars } from "@/components/ui/stars";
import { haptic } from "@/lib/haptics";
import { shareLink, thirdVariant } from "@/lib/share";
import { giftShareVariants } from "@/lib/random-copy";
import { APP_BASE_URL } from "@/lib/app-url";
import { giftRequiredLevel } from "@/lib/levels";
import { getKindMeta, type GiftKind } from "@/lib/gift-kinds";

export type ModalGift = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  image_urls?: string[] | null;
  cost: number;
  condition: number | null;
  owner_id: string | null;
  gift_kind: GiftKind;
  owner_name?: string;
  owner_level?: number;
  city?: string | null;
  is_online?: boolean | null;
};

function ballWord(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "балл";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "балла";
  return "баллов";
}

/**
 * Карточка подарка ПОВЕРХ ленты (не новая вкладка): слева фото с каруселью,
 * справа описание и кнопка «Получить». На телефоне блоки идут друг под другом.
 */
export function GiftDetailModal({
  gift,
  meId,
  userLevel,
  onPick,
  onLocked,
  onClose,
}: {
  gift: ModalGift;
  meId: string | null;
  userLevel: number;
  onPick: (id: string) => void;
  onLocked: (g: ModalGift, requiredLevel: number) => void;
  onClose: () => void;
}) {
  const photos =
    gift.image_urls && gift.image_urls.length > 0
      ? gift.image_urls
      : gift.image_url
        ? [gift.image_url]
        : [];
  const [i, setI] = useState(0);
  const touchX = useRef<number | null>(null);
  const prev = () => setI((p) => (p - 1 + photos.length) % photos.length);
  const next = () => setI((p) => (p + 1) % photos.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  const reqLevel = giftRequiredLevel(getKindMeta(gift.gift_kind)?.minLevel, gift.cost);
  const lockedByLevel = userLevel < reqLevel;
  const shareUrl = `${APP_BASE_URL}/gift/${gift.id}${meId ? `?ref=${meId}` : ""}`;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-3 sm:p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-background shadow-xl sm:max-w-3xl sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/55"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Фото + карусель */}
        <div className="relative shrink-0 bg-muted sm:w-1/2">
          {photos.length > 0 ? (
            <img
              src={photos[i]}
              alt={gift.title}
              onTouchStart={(e) => {
                touchX.current = e.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(e) => {
                if (touchX.current === null) return;
                const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
                if (Math.abs(dx) > 40) (dx < 0 ? next() : prev());
                touchX.current = null;
              }}
              className="h-60 w-full object-cover sm:h-full sm:max-h-[92dvh]"
            />
          ) : (
            <div className="flex h-60 w-full items-center justify-center text-6xl sm:h-full">🎁</div>
          )}
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={prev}
                aria-label="Назад"
                className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/55"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Вперёд"
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/55"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                {photos.map((_, n) => (
                  <span
                    key={n}
                    className={`h-2 w-2 rounded-full transition ${n === i ? "bg-white" : "bg-white/50"}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Описание + действия */}
        <div className="flex min-h-0 flex-1 flex-col sm:w-1/2">
          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-3 pr-10 sm:pr-10">
              <h2 className="text-xl font-semibold leading-tight">{gift.title}</h2>
              <span className="shrink-0 rounded-xl bg-mint/70 px-3 py-1 text-sm font-semibold text-mint-foreground">
                {gift.cost} {ballWord(gift.cost)}
              </span>
            </div>

            {gift.condition ? (
              <div className="mt-1.5 text-base leading-none" title={`Состояние: ${gift.condition} из 5`}>
                <Stars value={gift.condition} />
              </div>
            ) : null}

            {gift.description && (
              <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{gift.description}</p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              {gift.owner_id ? (
                <Link
                  to="/user/$userId"
                  params={{ userId: gift.owner_id }}
                  className="inline-flex items-center gap-2 rounded-2xl border bg-card px-3 py-1.5 shadow-sm transition active:scale-[0.98]"
                >
                  <span className="text-muted-foreground">Дарит</span>
                  <span className="font-semibold">{gift.owner_name ?? "Гость"}</span>
                  <LevelBadge level={gift.owner_level ?? 1} />
                </Link>
              ) : null}
              {gift.is_online ? (
                <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">
                  🌐 Онлайн
                </span>
              ) : gift.city ? (
                <span className="rounded-full bg-peach/40 px-2 py-1 text-xs font-medium text-foreground">
                  📍 {gift.city}
                </span>
              ) : null}
            </div>
          </div>

          {/* Действия — закреплены снизу */}
          <div className="space-y-2 border-t bg-background p-4">
            {lockedByLevel ? (
              <Button
                onClick={() => {
                  onClose();
                  onLocked(gift, reqLevel);
                }}
                variant="outline"
                className="w-full rounded-xl border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              >
                🔒 Откроется на {reqLevel} уровне
              </Button>
            ) : (
              <Button
                onClick={() => {
                  haptic("medium");
                  try {
                    localStorage.setItem("cozygift_last_claim_cost", String(gift.cost ?? 1));
                  } catch {
                    /* noop */
                  }
                  onPick(gift.id);
                }}
                className="w-full rounded-xl bg-mint text-mint-foreground hover:bg-mint/90"
                size="lg"
              >
                🎁 Получить за {gift.cost ?? 1} {ballWord(gift.cost ?? 1)}
              </Button>
            )}
            <button
              type="button"
              onClick={() => {
                shareLink(thirdVariant(giftShareVariants(gift.title)), shareUrl);
                toast.success("Спасибо, что зовёшь друзей 💚");
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border bg-card px-3 py-2.5 text-sm font-medium shadow-sm transition active:scale-[0.98] hover:bg-accent"
            >
              <Share2 className="h-4 w-4" /> Поделиться
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
