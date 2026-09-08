export function telegramLoginUrl(appUrl: string, nonce: string): string {
  const url = new URL(appUrl);
  url.searchParams.set("login", nonce);
  return url.toString();
}
