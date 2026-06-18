/** Бейдж местоположения: 📍 город или 🌐 Онлайн. Ничего не рисует, если данных нет. */
export function CityBadge({
  city,
  isOnline,
  className = "",
}: {
  city?: string | null;
  isOnline?: boolean | null;
  className?: string;
}) {
  if (isOnline)
    return (
      <span
        className={`rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 ${className}`}
      >
        🌐 Онлайн
      </span>
    );
  if (city && city.trim())
    return (
      <span
        className={`rounded-full bg-peach/40 px-2 py-0.5 text-[10px] font-medium text-foreground ${className}`}
      >
        📍 {city}
      </span>
    );
  return null;
}
