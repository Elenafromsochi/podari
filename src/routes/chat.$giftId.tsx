import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { ChatScreen } from "@/components/ChatScreen";
import { getActiveTransactionForGift } from "@/lib/cozy.functions";
import { loadUser, type UserProfile } from "@/lib/auth-state";

export const Route = createFileRoute("/chat/$giftId")({
  head: () => ({
    meta: [
      { title: "Чат — CozyGift" },
      { name: "description", content: "Общение с дарителем или получателем подарка" },
    ],
  }),
  component: ChatRoute,
});

function ChatRoute() {
  const { giftId } = Route.useParams();
  const navigate = useNavigate();
  const getTx = useServerFn(getActiveTransactionForGift);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      <div className="mx-auto flex min-h-[100dvh] max-w-md items-center justify-center px-5 text-muted-foreground">
        Загружаем чат…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-muted-foreground">Войдите, чтобы открыть чат.</p>
        <button
          onClick={() => navigate({ to: "/" })}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          На главную
        </button>
      </div>
    );
  }

  if (!txId) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-muted-foreground">Чат не найден.</p>
        <button
          onClick={() => navigate({ to: "/cabinet" })}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← В личный кабинет
        </button>
      </div>
    );
  }

  return (
    <ChatScreen
      giftId={giftId}
      transactionId={txId}
      onBack={() => navigate({ to: "/cabinet" })}
      onReview={() => {
        try {
          confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
        } catch {
          /* noop */
        }
        toast.success("Спасибо за отзыв 💚");
        navigate({ to: "/cabinet" });
      }}
    />
  );
}
