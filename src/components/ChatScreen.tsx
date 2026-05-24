import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Mic, MicOff, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ReviewModal } from "@/components/ReviewModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  cancelClaim,
  confirmHandover,
  declineHandover,
  requestHandover,
  sendChatMessage,
  submitReview,
} from "@/lib/cozy.functions";

type Msg = { id: string; from: "me" | "them"; text: string; ts: number };
type Gift = { id: string; title: string; image_url: string | null; owner_id: string | null };

const AUTO_MESSAGES = [
  "Мне понравился ваш подарок. Как могу его забрать? 😊",
  "Расскажите подробнее про ваш подарок, а именно… 💬",
];


type SR = {
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
};

export function ChatScreen({
  giftId,
  transactionId,
  onBack,
  onReview,
}: {
  giftId: string;
  transactionId: string;
  onBack: () => void;
  onHandover?: () => void;
  onReview?: () => void;
}) {
  const [gift, setGift] = useState<Gift | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [txStatus, setTxStatus] = useState<string>("pending");
  const [handoverRequestedAt, setHandoverRequestedAt] = useState<string | null>(null);
  const [showReceiverConfirm, setShowReceiverConfirm] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const recogRef = useRef<SR | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const reviewFn = useServerFn(submitReview);
  const cancelFn = useServerFn(cancelClaim);
  const sendMessageFn = useServerFn(sendChatMessage);
  const requestHandoverFn = useServerFn(requestHandover);
  const confirmHandoverFn = useServerFn(confirmHandover);
  const declineHandoverFn = useServerFn(declineHandover);

  const isOwner = !!(meId && gift && gift.owner_id === meId);
  const handedOver = txStatus === "completed";
  const cancelled = txStatus === "cancelled";

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const myId = u.user?.id ?? null;
      setMeId(myId);
      const { data } = await supabase
        .from("gifts")
        .select("id,title,image_url,owner_id")
        .eq("id", giftId)
        .maybeSingle();
      setGift(data as Gift | null);

      if (myId) {
        const { data: chat } = await supabase
          .from("chats")
          .select("id")
          .eq("gift_id", giftId)
          .or(`user_a.eq.${myId},user_b.eq.${myId}`)
          .maybeSingle();
        if (chat?.id) setChatId(chat.id as string);
      }
    })();
  }, [giftId]);

  // загрузка / отслеживание транзакции
  useEffect(() => {
    if (!transactionId || !meId) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("status, handover_requested_at, receiver_id")
        .eq("id", transactionId)
        .maybeSingle();
      if (!alive || !data) return;
      const row = data as { status: string; handover_requested_at: string | null; receiver_id: string };
      setTxStatus(row.status);
      setHandoverRequestedAt(row.handover_requested_at);
      if (row.handover_requested_at && row.receiver_id === meId && row.status === "pending") {
        setShowReceiverConfirm(true);
      }
    })();
    const channel = supabase
      .channel(`tx-${transactionId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "transactions", filter: `id=eq.${transactionId}` },
        (payload) => {
          const row = payload.new as { status: string; handover_requested_at: string | null; receiver_id: string };
          setTxStatus(row.status);
          setHandoverRequestedAt(row.handover_requested_at);
          if (row.handover_requested_at && row.receiver_id === meId && row.status === "pending") {
            setShowReceiverConfirm(true);
          }
          if (row.status === "completed") {
            // Обоим участникам — предложить отзыв (получателю и дарителю)
            setShowReview(true);
          }
        },
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [transactionId, meId]);

  // загрузка сообщений + realtime
  useEffect(() => {
    if (!chatId || !meId) return;
    let cancelledLocal = false;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, sender_id, content, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (cancelledLocal) return;
      setMessages(
        (data ?? []).map((m) => ({
          id: m.id as string,
          from: (m.sender_id === meId ? "me" : "them") as "me" | "them",
          text: m.content as string,
          ts: new Date(m.created_at as string).getTime(),
        })),
      );
    })();
    const channel = supabase
      .channel(`messages-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const m = payload.new as { id: string; sender_id: string; content: string; created_at: string };
          setMessages((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev;
            return [
              ...prev,
              {
                id: m.id,
                from: m.sender_id === meId ? "me" : "them",
                text: m.content,
                ts: new Date(m.created_at).getTime(),
              },
            ];
          });
        },
      )
      .subscribe();
    return () => {
      cancelledLocal = true;
      supabase.removeChannel(channel);
    };
  }, [chatId, meId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (!meId) {
      toast.error("Нужно войти в аккаунт, чтобы писать в чат");
      return;
    }
    if (!chatId) {
      toast.error("Чат ещё не готов", {
        description: "Подождите пару секунд и попробуйте снова",
      });
      return;
    }
    setText("");
    try {
      const inserted = await sendMessageFn({ data: { chat_id: chatId, content: t } });
      if (inserted?.id) {
        setMessages((prev) => {
          if (prev.some((x) => x.id === inserted.id)) return prev;
          return [
            ...prev,
            {
              id: inserted.id as string,
              from: "me",
              text: inserted.content as string,
              ts: new Date(inserted.created_at as string).getTime(),
            },
          ];
        });
      }
    } catch (e) {
      setText(t);
      toast.error("Не удалось отправить", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleCancel = async () => {
    if (cancelled || handedOver) return;
    try {
      await cancelFn({ data: { transaction_id: transactionId } });
    } catch (e) {
      toast.error("Не удалось отказаться", {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    toast.success("Вы отказались от подарка", {
      description: "Замороженные баллы возвращены на ваш счёт 💚",
    });
    setTimeout(() => navigate({ to: "/cabinet" }), 800);
  };

  const handleRequestHandover = async () => {
    try {
      await requestHandoverFn({ data: { transaction_id: transactionId } });
      setHandoverRequestedAt(new Date().toISOString());
      toast.success("Запрос отправлен получателю");
    } catch (e) {
      toast.error("Не удалось отправить запрос", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleReceiverYes = async () => {
    setShowReceiverConfirm(false);
    try {
      await confirmHandoverFn({ data: { transaction_id: transactionId } });
      toast.success("Подтверждено! Спасибо 💚");
    } catch (e) {
      toast.error("Не удалось подтвердить", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleReceiverNo = async () => {
    setShowReceiverConfirm(false);
    try {
      await declineHandoverFn({ data: { transaction_id: transactionId } });
      toast("Хорошо, ожидаем получения", { description: "Даритель сможет повторить запрос позже" });
    } catch (e) {
      toast.error("Не удалось отправить ответ", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const toggleMic = () => {
    const W = window as unknown as {
      SpeechRecognition?: new () => SR;
      webkitSpeechRecognition?: new () => SR;
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      toast.error("Голосовой ввод не поддерживается в этом браузере");
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let final = "";
      for (let i = 0; i < e.results.length; i++) final += e.results[i][0].transcript;
      setText(final);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recogRef.current = r;
    r.start();
    setListening(true);
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <button onClick={onBack} className="text-sm text-muted-foreground underline-offset-4 hover:underline">←</button>
        {gift?.image_url ? (
          <img src={gift.image_url} alt={gift.title} className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">🎁</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {isOwner ? "Чат с получателем" : "Чат с дарителем"}
          </div>
          <div className="truncate text-xs text-muted-foreground">{gift?.title ?? "Подарок"}</div>
        </div>
        {isOwner ? (
          <Button
            size="sm"
            variant="outline"
            disabled={handedOver || cancelled || !!handoverRequestedAt}
            onClick={handleRequestHandover}
            className="rounded-full"
          >
            <Check className="h-4 w-4" />
            {handedOver
              ? "Получено"
              : handoverRequestedAt
                ? "Ожидаем..."
                : "Подтвердить получение"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={cancelled || handedOver}
            onClick={handleCancel}
            className="rounded-full"
          >
            <X className="h-4 w-4" />
            {cancelled ? "Отказано" : "Отказаться"}
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Поздоровайтесь — выберите готовое сообщение или напишите своё
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
              m.from === "me" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {!isOwner && !handedOver && !cancelled && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2">
          {AUTO_MESSAGES.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={!chatId}
              className="shrink-0 rounded-full border bg-card px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-t bg-card px-3 py-3">
        <button
          onClick={toggleMic}
          className={`flex h-10 w-10 items-center justify-center rounded-full border ${
            listening ? "bg-destructive text-destructive-foreground" : "bg-background"
          }`}
          aria-label="Голосовой ввод"
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(text); }}
          placeholder={listening ? "Слушаю…" : "Напишите сообщение"}
          className="flex-1 rounded-full border bg-background px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="icon" className="rounded-full" onClick={() => send(text)}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <AlertDialog open={showReceiverConfirm} onOpenChange={setShowReceiverConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подарок получен?</AlertDialogTitle>
            <AlertDialogDescription>
              Даритель просит подтвердить получение подарка «{gift?.title ?? ""}».
              После подтверждения замороженные баллы окончательно спишутся, а даритель получит вознаграждение.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleReceiverNo}>Нет</AlertDialogCancel>
            <AlertDialogAction onClick={handleReceiverYes}>Да</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showReview && (
        <ReviewModal
          giftId={giftId}
          onSubmit={async ({ presetId, label, comment }) => {
            const rating = presetId === "success" ? 5 : 3;
            const fullComment = [label, comment].filter(Boolean).join(" — ");
            try {
              if (gift?.owner_id) {
                await reviewFn({
                  data: {
                    transaction_id: transactionId,
                    target_id: gift.owner_id,
                    rating,
                    comment: fullComment || undefined,
                  },
                });
              }
            } catch (e) {
              toast.error("Отзыв не сохранён", {
                description: e instanceof Error ? e.message : String(e),
              });
            }
            setShowReview(false);
            onReview?.();
          }}
        />
      )}
    </div>
  );
}
