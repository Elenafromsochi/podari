import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { AppShell } from "@/components/AppShell";
import { GlobalChrome } from "@/components/GlobalChrome";


import { GiveGiftChips } from "@/components/GiveGiftChips";
import { GiveGiftForm } from "@/components/GiveGiftForm";
import { ReceiveGiftFlow } from "@/components/ReceiveGiftFlow";
import { ChatScreen } from "@/components/ChatScreen";
import { AuthFlow } from "@/components/AuthFlow";
import { PublishSuccess } from "@/components/PublishSuccess";
import { WishForm } from "@/components/WishForm";
import { WishDetails } from "@/components/WishDetails";
import { WishChatScreen } from "@/components/WishChatScreen";
import { pickRandom, PUBLISH_THANKS_TITLES, PUBLISH_THANKS_DESCRIPTIONS, WISH_PUBLISH_THANKS } from "@/lib/random-copy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { startTourForUser, emitTour } from "@/lib/tour";
import { claimGift } from "@/lib/cozy.functions";
import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/lib/haptics";

const ACTIVE_CHAT_KEY = "cozygift_active_chat_gift";
const ACTIVE_TX_KEY = "cozygift_active_tx";

export const Route = createFileRoute("/")({
  component: Index,
});

type Flow =
  | { kind: "none" }
  | { kind: "give_chip" }
  | { kind: "give_form"; presetHint: string | null; giftKind: import("@/lib/gift-kinds").GiftKind }
  | { kind: "publish_success" }
  | { kind: "receive" }
  | { kind: "chat"; giftId: string; txId: string }
  | { kind: "wish_form" }
  | { kind: "wish_details"; wishId: string }
  | { kind: "wish_chat"; wishId: string; txId: string };

const burstConfetti = () => {
  const opts = { spread: 80, ticks: 200, gravity: 0.9, scalar: 1.1 } as const;
  confetti({ ...opts, particleCount: 80, origin: { x: 0.2, y: 0.7 } });
  confetti({ ...opts, particleCount: 80, origin: { x: 0.8, y: 0.7 } });
  setTimeout(
    () => confetti({ ...opts, particleCount: 120, origin: { x: 0.5, y: 0.4 } }),
    250,
  );
};

function Index() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [pendingLoginNonce, setPendingLoginNonce] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow>({ kind: "none" });
  const [insufficientOpen, setInsufficientOpen] = useState(false);

  const claim = useServerFn(claimGift);

  const refreshUser = async () => {
    const u = await loadUser();
    setUser(u);
    return u;
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u = await loadUser();
      if (!mounted) return;
      setUser(u);
      setAuthChecked(true);
      if (u) startTourForUser(u.user_id, u.xp, false);
    })();
    if (typeof window !== "undefined") {
      // Активный чат больше НЕ открываем автоматически при входе — иначе
      // приложение «встречает» человека чатом вместо главной. Чат остаётся
      // доступен во вкладке «Чаты». Чистим возможный залежавшийся след.
      localStorage.removeItem(ACTIVE_CHAT_KEY);
      localStorage.removeItem(ACTIVE_TX_KEY);
      try {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get("ref");
        const isUuid =
          ref && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
        if (isUuid) localStorage.setItem("cozygift_pending_ref", ref!);
        const login = params.get("login");
        if (login && /^[A-Za-z0-9_-]{8,32}$/.test(login)) setPendingLoginNonce(login);
        if (isUuid || login) {
          const url = new URL(window.location.href);
          url.searchParams.delete("ref");
          url.searchParams.delete("login");
          window.history.replaceState({}, "", url.toString());
        }
      } catch {
        /* ignore */
      }
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setUser(null);
      else loadUser().then(setUser);
    });
    // Нижняя навигация из внутреннего экрана (чат/форма): сбрасываем flow,
    // чтобы показать выбранную вкладку, а не «застрять» в чате.
    const onNavTab = () => setFlow({ kind: "none" });
    window.addEventListener("cozy:nav-tab", onNavTab);
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("cozy:nav-tab", onNavTab);
    };
  }, []);

  if (!authChecked) return null;

  if (!user) {
    return (
      <AuthFlow
        initialNonce={pendingLoginNonce}
        onAuthed={(u, isNew) => {
          setPendingLoginNonce(null);
          setUser(u);
          startTourForUser(u.user_id, u.xp, !!isNew);
        }}
      />
    );
  }

  const handlePickGift = async (giftId: string) => {
    try {
      const res = await claim({ data: { gift_id: giftId } });
      localStorage.setItem(ACTIVE_CHAT_KEY, giftId);
      localStorage.setItem(ACTIVE_TX_KEY, res.transaction_id);
      await refreshUser();
      haptic("success");
      const cost = (() => {
        try {
          const n = Number(localStorage.getItem("cozygift_last_claim_cost"));
          return Number.isFinite(n) && n > 0 ? n : 1;
        } catch {
          return 1;
        }
      })();
      const m10 = cost % 10;
      const m100 = cost % 100;
      const word =
        m10 === 1 && m100 !== 11
          ? "балл"
          : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)
            ? "балла"
            : "баллов";
      toast.success(`Заморожено ${cost} ${word} • Безопасная сделка 🔒`, {
        description: "Открываем чат с дарителем",
      });
      setFlow({ kind: "chat", giftId, txId: res.transaction_id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("INSUFFICIENT_BALANCE")) setInsufficientOpen(true);
      else if (msg.includes("ALREADY_TAKEN"))
        toast.error("Подарок уже забрали", { description: "Выбери другой 💚" });
      else if (msg.includes("OWN_GIFT"))
        toast.error("Это твой подарок", { description: "Своё забрать нельзя 🙂" });
      else toast.error("Не получилось забрать подарок", { description: msg });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background">

      {flow.kind === "none" && (
        <AppShell
          user={user}
          onGive={() => { emitTour("give-opened"); setFlow({ kind: "give_chip" }); }}
          onReceive={() => setFlow({ kind: "receive" })}
          onPickGift={handlePickGift}
          onCreateWish={() => setFlow({ kind: "wish_form" })}
          onOpenWish={(wishId) => setFlow({ kind: "wish_details", wishId })}
          initialTab={
            typeof window !== "undefined" &&
            new URLSearchParams(window.location.search).get("tab") === "chats"
              ? "chats"
              : "home"
          }
        />
      )}

      {flow.kind === "wish_form" && (
        <GlobalChrome>
        <WishForm
          onBack={() => setFlow({ kind: "none" })}
          onDone={async (id) => {
            burstConfetti();
            haptic("success");
            toast.success(pickRandom(WISH_PUBLISH_THANKS), {
              description: "Любой пользователь может откликнуться ✨",
            });
            await refreshUser();
            setFlow({ kind: "wish_details", wishId: id });
          }}
        />
        </GlobalChrome>
      )}

      {flow.kind === "wish_details" && (
        <GlobalChrome>
        <WishDetails
          wishId={flow.wishId}
          onBack={() => setFlow({ kind: "none" })}
          onFulfilled={(txId, _chatId, wishId) =>
            setFlow({ kind: "wish_chat", wishId, txId })
          }
          onDeleted={() => setFlow({ kind: "none" })}
        />
        </GlobalChrome>
      )}

      {flow.kind === "wish_chat" && (
        <GlobalChrome>
        <WishChatScreen
          wishId={flow.wishId}
          transactionId={flow.txId}
          onBack={() => setFlow({ kind: "none" })}
          onCompleted={async () => {
            burstConfetti();
            haptic("success");
            await refreshUser();
            setFlow({ kind: "none" });
          }}
        />
        </GlobalChrome>
      )}

      {flow.kind === "give_chip" && (
        <GlobalChrome>
        <GiveGiftChips
          onBack={() => setFlow({ kind: "none" })}
          userLevel={user.level}
          onPick={(kind, label) => {
            try {
              localStorage.setItem("cozygift_tour_give_kind", kind);
            } catch {
              /* noop */
            }
            emitTour("give-kind-picked");
            setFlow({ kind: "give_form", presetHint: label, giftKind: kind });
          }}
        />
        </GlobalChrome>
      )}

      {flow.kind === "give_form" && (
        <GlobalChrome>
        <GiveGiftForm
          onBack={() => setFlow({ kind: "give_chip" })}
          presetHint={flow.presetHint}
          giftKind={flow.giftKind}
          onDone={async () => {
            burstConfetti();
            haptic("success");
            toast.success(pickRandom(PUBLISH_THANKS_TITLES), {
              description: pickRandom(PUBLISH_THANKS_DESCRIPTIONS),
            });
            await refreshUser();
            setFlow({ kind: "publish_success" });
          }}
        />
        </GlobalChrome>
      )}

      {flow.kind === "publish_success" && (
        <GlobalChrome>
        <PublishSuccess
          balance={Number(user.balance)}
          onGiveAnother={() => setFlow({ kind: "give_chip" })}
          onReceive={() => setFlow({ kind: "receive" })}
          onHome={() => setFlow({ kind: "none" })}
        />
        </GlobalChrome>
      )}

      {flow.kind === "receive" && (
        <GlobalChrome>
        <ReceiveGiftFlow
          onBack={() => setFlow({ kind: "none" })}
          userLevel={user.level}
          onPick={handlePickGift}
          onCreateWish={() => setFlow({ kind: "wish_form" })}
        />
        </GlobalChrome>
      )}

      {flow.kind === "chat" && (
        <GlobalChrome>
        <ChatScreen
          giftId={flow.giftId}
          transactionId={flow.txId}
          onBack={() => {
            localStorage.removeItem(ACTIVE_CHAT_KEY);
            localStorage.removeItem(ACTIVE_TX_KEY);
            setFlow({ kind: "none" });
          }}
          onHandover={async () => {
            await refreshUser();
          }}
          onReview={async () => {
            burstConfetti();
            haptic("success");
            toast.success("Спасибо за отзыв • +20 Опыта 💚");
            await refreshUser();
            localStorage.removeItem(ACTIVE_CHAT_KEY);
            localStorage.removeItem(ACTIVE_TX_KEY);
            setFlow({ kind: "none" });
          }}
        />
        </GlobalChrome>
      )}

      <Dialog open={insufficientOpen} onOpenChange={setInsufficientOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Недостаточно подарочных баллов 🎁</DialogTitle>
            <DialogDescription className="pt-2 text-left">
              Чтобы выбрать новый подарок, нужен <b>1 балл</b>. Сейчас твой баланс пуст или баллы
              заморожены в другой сделке.
              <br />
              <br />
              Размести свой подарок (+0.2 балла) и дождись вручения (+0.8 балла) — так баланс
              восстановится. Дарить и получать одинаково важно 💚
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <button
              onClick={() => {
                setInsufficientOpen(false);
                setFlow({ kind: "give_chip" });
              }}
              className="w-full rounded-2xl bg-mint px-5 py-3 text-base font-semibold text-mint-foreground transition hover:bg-mint/90"
            >
              ➕ Разместить подарок
            </button>
            <button
              onClick={() => setInsufficientOpen(false)}
              className="w-full rounded-2xl border px-5 py-3 text-sm text-muted-foreground transition hover:bg-accent"
            >
              Понятно
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* useNavigate referenced to keep router import stable for future redirects */}
      <span hidden>{String(!!navigate)}</span>
    </div>
  );
}
