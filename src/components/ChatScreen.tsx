import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Send, Bell, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ReviewModal } from "@/components/ReviewModal";
import { cancelClaim, sendChatMessage, submitReview } from "@/lib/cozy.functions";

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
  const [handedOver, setHandedOver] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const recogRef = useRef<SR | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const reviewFn = useServerFn(submitReview);
  const cancelFn = useServerFn(cancelClaim);
  const sendMessageFn = useServerFn(sendChatMessage);

  const isOwner = !!(meId && gift && gift.owner_id === meId);

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

      // найти чат для этого подарка, где текущий пользователь — участник
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
    try {
      const h = localStorage.getItem(`cozygift_handover_${giftId}`);
      const r = localStorage.getItem(`cozygift_review_${giftId}`);
      if (h) setHandedOver(true);
      if (h && !r) setShowReview(true);
    } catch { /* noop */ }
  }, [giftId]);

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
      // вернём текст обратно, чтобы не потерять написанное
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
    setCancelled(true);
    toast.success("Вы отказались от подарка", {
      description: "Замороженные баллы возвращены на ваш счёт 💚",
    });
    setTimeout(() => navigate({ to: "/cabinet" }), 800);
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
            {meId && gift?.owner_id === meId ? "Чат с получателем" : "Чат с дарителем"}
          </div>
          <div className="truncate text-xs text-muted-foreground">{gift?.title ?? "Подарок"}</div>
        </div>
        {meId && gift && gift.owner_id !== meId && (
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

      {!isOwner && (
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
              localStorage.setItem(`cozygift_review_${giftId}`, String(Date.now()));
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
