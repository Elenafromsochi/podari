// Значок (бейдж) с числом непрочитанных на иконке установленного приложения.
// Работает на iPhone (PWA на экране «Домой») и в десктопных Chrome/Edge.
// На Android и где не поддерживается — просто ничего не делает.
export function setAppBadge(count: number) {
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0 && typeof nav.setAppBadge === "function") {
      nav.setAppBadge(count).catch(() => {});
    } else if (typeof nav.clearAppBadge === "function") {
      nav.clearAppBadge().catch(() => {});
    }
  } catch {
    /* noop */
  }
}
