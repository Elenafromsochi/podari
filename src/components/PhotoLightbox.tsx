import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Полноэкранный просмотр фотографий с каруселью: свайп пальцем, стрелки,
 * точки-индикаторы, закрытие по фону/крестику/Esc.
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

  if (!photos.length) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 animate-fade-in"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Закрыть"
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Просмотр «под смартфон»: ширина ограничена телефонной колонкой, по
          центру. На большом экране (планшет/комп) фото не разворачивается на
          всю ширину, а стрелки и точки держатся у самого фото. */}
      <div
        className="relative flex max-h-[85dvh] w-full max-w-[min(92vw,26rem)] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
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
          className="max-h-[85dvh] max-w-full rounded-xl object-contain"
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
              className="absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
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
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
              {photos.map((_, n) => (
                <span
                  key={n}
                  className={`h-2 w-2 rounded-full transition ${
                    n === i ? "bg-white" : "bg-white/40"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
