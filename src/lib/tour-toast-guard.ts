import { toast } from "sonner";
import { isTourActive } from "@/lib/tour";

// Пока идёт гид, всплывающие тосты не показываем: они дублируют подсказки
// гида и мелькают слишком быстро. Как только гид завершён/пропущен —
// уведомления снова работают как обычно (включая последующие шаги, которые
// человек делает сам). Ошибки (toast.error) не глушим — их важно видеть.
let installed = false;

export function installTourToastGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const methods = ["success", "info", "warning", "message"] as const;
  for (const m of methods) {
    const orig = (toast as unknown as Record<string, unknown>)[m];
    if (typeof orig !== "function") continue;
    (toast as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
      if (isTourActive()) return undefined;
      return (orig as (...a: unknown[]) => unknown).apply(toast, args);
    };
  }
}
