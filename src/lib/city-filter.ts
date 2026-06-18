// Общая логика фильтра по городу/онлайн для подарков и желаний.
// Онлайн-элементы доступны в любом городе, поэтому показываются и при
// выбранном городе. Спец-значение "__online__" — только онлайн.

export type Located = { city?: string | null; is_online?: boolean | null };

export function applyCityFilter<T extends Located>(list: T[], cityFilter: string | null) {
  const counts = new Map<string, number>();
  let online = 0;
  for (const it of list) {
    if (it.is_online) online++;
    else if (it.city && it.city.trim()) counts.set(it.city, (counts.get(it.city) ?? 0) + 1);
  }
  const cities = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const validCity =
    cityFilter === "__online__"
      ? online > 0
        ? "__online__"
        : null
      : cityFilter && counts.has(cityFilter)
        ? cityFilter
        : null;
  const pool = !validCity
    ? list
    : validCity === "__online__"
      ? list.filter((it) => it.is_online)
      : list.filter((it) => it.city === validCity || it.is_online);
  return { cities, online, validCity, pool };
}
