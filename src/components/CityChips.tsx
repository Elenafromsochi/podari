/** Строка чипов фильтра по городу/онлайн. Показывается, только если есть из
 *  чего выбирать (минимум два варианта). */
export function CityChips({
  cities,
  online,
  value,
  onChange,
}: {
  cities: [string, number][];
  online: number;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (cities.length + (online > 0 ? 1 : 0) < 2) return null;
  const cls = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
      active
        ? "border-mint bg-mint text-mint-foreground shadow-sm"
        : "border-input bg-card text-muted-foreground hover:bg-accent"
    }`;
  return (
    <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
      <button onClick={() => onChange(null)} className={cls(!value)}>
        🌍 Все города
      </button>
      {cities.map(([c, n]) => (
        <button key={c} onClick={() => onChange(c)} className={cls(value === c)}>
          📍 {c} <span className="opacity-70">{n}</span>
        </button>
      ))}
      {online > 0 && (
        <button onClick={() => onChange("__online__")} className={cls(value === "__online__")}>
          🌐 Онлайн <span className="opacity-70">{online}</span>
        </button>
      )}
    </div>
  );
}
