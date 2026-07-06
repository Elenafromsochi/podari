import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Просмотр фотографий поверх страницы: фото всплывает как аккуратная карточка
 * по центру экрана (не растягивается на весь чёрный экран), с каруселью —
 * свайп пальцем, стрелки, точки-индикаторы. Закрытие по фону/крестику/Esc.
 *
 * ВАЖНО: рендерим через портал в <body>, иначе `position: fixed` считается
 * относительно ближайшего предка с transform/filter (у нас это `.tab-reveal`),
 * и карточка «уезжает» вниз. Портал в body лечит это раз и навсегда.
 */
export function PhotoLightbox({
  photos,
  startIndex = 0,
  onClose,
}: {
  photos: string[];
  startIndex?: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(startIndex);
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
  }, [photos.length, onClose]);

  // Пока открыт просмотр — фон под ним не прокручивается.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (!photos.length || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      {/* Карточка с фото по центру — небольшая, «под смартфон», не на весь экран. */}
      <div
        className="relative flex max-h-[82dvh] w-full max-w-[min(88vw,22rem)] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute -right-2 -top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-foreground shadow-lg ring-1 ring-black/10 transition hover:scale-105 active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>

        <img
          src={photos[i]}
          alt=""
          onTouchStart={(e) => {
            touchX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
            if (Math.abs(dx) > 40) (dx < 0 ? next() : prev());
            touchX.current = null;
          }}
          className="max-h-[82dvh] max-w-full rounded-2xl bg-background object-contain shadow-2xl"
        />

        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              aria-label="Назад"
              className="absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground shadow-md ring-1 ring-black/10 transition hover:bg-white active:scale-95"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              aria-label="Вперёд"
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground shadow-md ring-1 ring-black/10 transition hover:bg-white active:scale-95"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/35 px-2 py-1 backdrop-blur">
              {photos.map((_, n) => (
                <span
                  key={n}
                  className={`h-2 w-2 rounded-full transition ${
                    n === i ? "bg-white" : "bg-white/50"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
