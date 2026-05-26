// Stable per-browser device identifier, persisted in localStorage.
// Server uses it to remember "trusted devices" after 2FA confirmation.

const KEY = "cozygift_device_id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id =
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getDeviceLabel(): string {
  if (typeof window === "undefined") return "Unknown";
  const ua = navigator.userAgent || "";
  // Очень грубая нарезка — нам нужна только подсказка пользователю.
  const platform =
    /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Web";
  const browser =
    /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  return `${platform} • ${browser}`;
}
