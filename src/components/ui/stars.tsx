// Единый показ оценки 1–5 звёздами (★ заполнённая, ☆ пустая).
// Используется и для состояния подарка, и для рейтинга в отзывах,
// чтобы по всему приложению был один стиль.
export function Stars({ value }: { value: number }) {
  return (
    <>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= value ? "text-amber-400" : "text-muted-foreground/30"}>
          {n <= value ? "★" : "☆"}
        </span>
      ))}
    </>
  );
}
