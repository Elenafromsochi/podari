import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Bell, Gift as GiftIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ReviewModal } from "@/components/ReviewModal";

type Msg = { id: string; from: "me" | "them"; text: string; ts: number };
type Gift = { id: string; title: string; image_url: string | null };

const AUTO_MESSAGES = [
  "Здравствуйте! Спасибо за подарок 💚",
  "Подскажите, когда удобно забрать?",
  "Очень рад(а), что нашёл(ла) ваш подарок ✨",
  "Можно уточнить детали?",
];

const STORAGE_KEY = (giftId: string) => `cozygift_chat_${giftId}`;

// Web Speech API typing
type SpeechRecognitionLike = {
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
  onBack,
}: {
  giftId: string;
  onBack: () => void;
}) {
  const [gift, setGift] = useState<Gift | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [notified, setNotified] = useState(true);
  const [handedOver, setHandedOver] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load gift + chat history
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("gifts")
        .select("id,title,image_url")
        .eq("id", giftId)
        .maybeSingle();
      setGift(data as Gift | null);
    })();
    try {
      const raw = localStorage.getItem(STORAGE_KEY(giftId));
      setMessages(raw ? JSON.parse(raw) : []);
    } catch {
      setMessages([]);
    }
  }, [giftId]);

  // Restore handover/review state
  useEffect(() => {
    try {
      const h = localStorage.getItem(`cozygift_handover_${giftId}`);
      const r = localStorage.getItem(`cozygift_review_${giftId}`);
      if (h) setHandedOver(true);
      if (h && !r) setShowReview(true);
    } catch {
      /* noop */
    }
  }, [giftId]);

  const markHandedOver = () => {
    if (handedOver) return;
    setHandedOver(true);
    localStorage.setItem(`cozygift_handover_${giftId}`, String(Date.now()));
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        from: "me",
        text: "🎁 Подарок передан",
        ts: Date.now(),
      },
    ]);
    toast.success("Получатель уведомлён", {
      description: "Откроется окно отзыва о подарке",
    });
    setTimeout(() => setShowReview(true), 600);
  };

  // Persist
  useEffect(() => {
    if (messages.length) {
      localStorage.setItem(STORAGE_KEY(giftId), JSON.stringify(messages));
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, giftId]);

  const send = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    setMessages((m) => [...m, { id: crypto.randomUUID(), from: "me", text: t, ts: Date.now() }]);
    setText("");
    // Имитация ответа дарителя
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          from: "them",
          text: "Спасибо! Я скоро отвечу подробнее 💌",
          ts: Date.now(),
        },
      ]);
    }, 1400);
  };

  const toggleMic = () => {
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
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
      for (let i = 0; i < e.results.length; i++) {
        final += e.results[i][0].transcript;
      }
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
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ←
        </button>
        {gift?.image_url ? (
          <img
            src={gift.image_url}
            alt={gift.title}
            className="h-10 w-10 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">🎁</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Чат с дарителем</div>
          <div className="truncate text-xs text-muted-foreground">{gift?.title ?? "Подарок"}</div>
        </div>
        <Button
          size="sm"
          variant={handedOver ? "secondary" : "default"}
          disabled={handedOver}
          onClick={markHandedOver}
          className="rounded-full"
        >
          <GiftIcon className="h-4 w-4" />
          {handedOver ? "Передано" : "Подарено"}
        </Button>
      </div>

      {/* Мок-уведомление о доставленном уведомлении дарителю */}
      {notified && (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-2xl border bg-mint/30 p-3 text-sm">
          <Bell className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">Даритель получил уведомление</div>
            <div className="text-xs text-muted-foreground">
              «У вашего подарка появился получатель — перейти в чат»
            </div>
          </div>
          <button
            onClick={() => setNotified(false)}
            className="text-xs text-muted-foreground hover:underline"
          >
            скрыть
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Поздоровайтесь — выберите готовое сообщение или напишите своё
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.from === "me"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {/* Auto-suggestions */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-2">
        {AUTO_MESSAGES.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            className="shrink-0 rounded-full border bg-card px-3 py-1.5 text-xs hover:bg-accent"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
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
          onKeyDown={(e) => {
            if (e.key === "Enter") send(text);
          }}
          placeholder={listening ? "Слушаю…" : "Напишите сообщение"}
          className="flex-1 rounded-full border bg-background px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="icon" className="rounded-full" onClick={() => send(text)}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
