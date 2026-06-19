// Русское склонение существительного по числу.
// plural(1, ["подарок", "подарка", "подарков"]) → "подарок"
// plural(3, ...) → "подарка", plural(5, ...) → "подарков"
export function plural(n: number, forms: [string, string, string]): string {
  const n10 = Math.abs(n) % 10;
  const n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}
