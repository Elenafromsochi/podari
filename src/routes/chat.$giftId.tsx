import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { ChatScreen } from "@/components/ChatScreen";
import { GlobalChrome } from "@/components/GlobalChrome";
import { getActiveTransactionForGift } from "@/lib/cozy.functions";
import { loadUser, type UserProfile } from "@/lib/auth-state";

export const Route = createFileRoute("/chat/$giftId")({
  head: () => ({
    meta: [
      { title: "Чат — Подари" },
      { name: "description", content: "Общение с дарителем или получателем подарка" },
    ],
  }),
  component: ChatRoute,
});

function ChatRoute() {
  const { giftId } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const getTx = useServerFn(getActiveTransactionForGift);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      navigate({ to: "/" });
    }
  };

  useEffect(() => {
    (async () => {
      const u = await loadUser();
      setUser(u);
      if (!u) {
        setLoading(false);
        return;
      }
      try {
        const tx = await getTx({ data: { gift_id: giftId } });
        setTxId((tx as { id: string } | null)?.id ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, [giftId, getTx]);

  if (loading) {
    return (
      <GlobalChrome>
        <div className="mx-auto flex max-w-md items-center justify-center px-5 py-16 text-muted-foreground">
          Загружаем чат…
        </div>
      </GlobalChrome>
    );
  }

  if (!user) {
    return (
      <GlobalChrome>
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-5 py-16 text-center">
          <p className="text-muted-foreground">Войдите, чтобы открыть чат.</p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            На главную
          </button>
        </div>
      </GlobalChrome>
    );
  }

  if (!txId) {
    return (
      <GlobalChrome>
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-5 py-16 text-center">
          <p className="text-muted-foreground">Чат не найден.</p>
          <button
            onClick={goBack}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            ← Назад
          </button>
        </div>
      </GlobalChrome>
    );
  }

  return (
    <GlobalChrome>
      <ChatScreen
        giftId={giftId}
        transactionId={txId}
        onBack={goBack}
        onReview={() => {
          try {
            confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
          } catch {
            /* noop */
          }
          toast.success("Спасибо за отзыв 💚");
          goBack();
        }}
      />
    </GlobalChrome>
  );
}
