interface Props {
  level: number;
  className?: string;
  size?: "sm" | "md";
}

// Единый бейдж уровня — используется во всех плашках, карточках и описаниях пользователей.
export function LevelBadge({ level, className = "", size = "sm" }: Props) {
  const sizeCls =
    size === "md"
      ? "px-2 py-0.5 text-xs"
      : "px-1.5 py-0.5 text-[10.5px]";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full bg-peach/60 font-semibold leading-none text-peach-foreground ${sizeCls} ${className}`}
      aria-label={`Уровень ${level}`}
    >
      <span aria-hidden>⭐</span>
      <span className="tabular-nums">{level}</span>
    </span>
  );
}
