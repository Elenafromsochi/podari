import { useEffect, useState } from "react";
import { AdminMessageDialog } from "@/components/WriteToAdminDialog";

// Флаг ставит TourOverlay, когда гид прерван НЕ до конца (Пропустить / «Не
// сейчас»). При полном прохождении флага нет — плашку не показываем.
const FLAG = "cozygift_tour_report_prompt";

/**
 * Плашка после прерванного гида: предлагает прислать админу скриншот ошибки,
 * из-за которой человек не дошёл до конца. Появляется только при раннем выходе.
 */
export function TourExitReport() {
  const [show, setShow] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      try {
        if (localStorage.getItem(FLAG) === "1") setShow(true);
      } catch {
        /* noop */
      }
    };
    check();
    window.addEventListener("cozy:tour-exit", check);
    return () => window.removeEventListener("cozy:tour-exit", check);
  }, []);

  const clearFlag = () => {
    try {
      localStorage.removeItem(FLAG);
    } catch {
      /* noop */
    }
  };

  const dismiss = () => {
    setShow(false);
    clearFlag();
  };

  const openReport = () => {
    setShow(false);
    clearFlag();
    setDialogOpen(true);
  };

  return (
    <>
      {show && (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4 animate-fade-in"
          onClick={dismiss}
        >
          <div
            className="w-full max-w-md rounded-2xl border bg-background p-5 shadow-xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">Что-то пошло не так в гиде? 💛</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Если ты увидел ошибку и не смог пройти дальше — пришли скриншот экрана с ошибкой.
              Это очень поможет нам всё починить 💚
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={openReport}
                className="flex-1 rounded-xl bg-mint px-4 py-2.5 text-sm font-semibold text-mint-foreground transition active:scale-[0.98] hover:bg-mint/90"
              >
                📷 Сообщить об ошибке
              </button>
              <button
                onClick={dismiss}
                className="rounded-xl border px-4 py-2.5 text-sm text-muted-foreground transition hover:bg-accent"
              >
                Не сейчас
              </button>
            </div>
          </div>
        </div>
      )}

      <AdminMessageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Сообщить об ошибке"
        description="Опиши, что не получилось, и приложи скриншот экрана с ошибкой — так мы быстро всё починим 💚"
        placeholder="На каком шаге застрял и что было на экране?"
      />
    </>
  );
}
