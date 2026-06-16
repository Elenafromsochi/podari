import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Send, X } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  cancelBySender,
  cancelClaim,
  confirmHandover,
  declineHandover,
  requestHandover,
  sendChatMessage,
  submitReview,
} from "@/lib/cozy.functions";
import { uploadImage } from "@/lib/upload-image";
import { emitTour } from "@/lib/tour";

type Msg = { id: string; from: "me" | "them"; text: string; ts: number };

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
function Linkified({ text, isMe }: { text: string; isMe: boolean }) {
  const parts = text.split(URL_RE);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (i % 2 === 1) {
          const href = p.startsWith("http") ? p : `https://${p}`;
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline underline-offset-2 ${isMe ? "text-primary-foreground" : "text-primary"}`}
            >
              {p}
            </a>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}
type Gift = { id: string; title: string; description?: string | null; image_url: string | null; image_urls?: string[] | null; owner_id: string | null; condition?: number | null };

const RECEIVER_HINTS = [
  "Мне понравился ваш подарок. Как могу его забрать? 😊",
  "Расскажите подробнее о вашем подарке, а именно… ",
];
const OWNER_HINTS = [
  "Здравствуйте! Спасибо, что выбрали подарок 💚",
  "Когда вам удобно его забрать?",
];



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
  const [partner, setPartner] = useState<{ id: string; name: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  
  const [txStatus, setTxStatus] = useState<string>("pending");
  const [handoverRequestedAt, setHandoverRequestedAt] = useState<string | null>(null);
  const [showReceiverConfirm, setShowReceiverConfirm] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const navigate = useNavigate();

  const reviewFn = useServerFn(submitReview);
  const cancelFn = useServerFn(cancelClaim);
  const cancelBySenderFn = useServerFn(cancelBySender);
  const sendMessageFn = useServerFn(sendChatMessage);
  const requestHandoverFn = useServerFn(requestHandover);
  const confirmHandoverFn = useServerFn(confirmHandover);
  const declineHandoverFn = useServerFn(declineHandover);

  const isOwner = !!(meId && gift && gift.owner_id === meId);
  const handedOver = txStatus === "completed";
  const cancelled = txStatus === "cancelled";

  useEffect(() => {
    emitTour("chat-opened");
  }, []);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const myId = u.user?.id ?? null;
      setMeId(myId);
      const { data } = await supabase
        .from("gifts")
        .select("id,title,description,image_url,image_urls,owner_id,condition")
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

  // load partner (other party) id + name
  useEffect(() => {
    if (!meId || !gift || !transactionId) return;
    (async () => {
      let partnerId: string | null = null;
      if (gift.owner_id === meId) {
        const { data: tx } = await supabase
          .from("transactions")
          .select("sender_id,receiver_id")
          .eq("id", transactionId)
          .maybeSingle();
        const row = tx as { sender_id: string | null; receiver_id: string | null } | null;
        partnerId = row ? (row.sender_id === meId ? row.receiver_id : row.sender_id) : null;
      } else {
        partnerId = gift.owner_id;
      }
      if (!partnerId) return;
      const { data: profs } = await supabase
        .rpc("get_public_profiles", { _user_ids: [partnerId] });
      const list = (profs ?? []) as Array<{ user_id: string; display_name: string }>;
      const name = list[0]?.display_name || "Гость";
      setPartner({ id: partnerId, name });
    })();
  }, [meId, gift, transactionId]);


  // загрузка / отслеживание транзакции (realtime + polling fallback)
  useEffect(() => {
    if (!transactionId || !meId) return;
    let alive = true;
    const fetchTx = async () => {
      const { data } = await supabase
        .from("transactions")
        .select("status, handover_requested_at, receiver_id")
        .eq("id", transactionId)
        .maybeSingle();
      if (!alive || !data) return;
      const row = data as { status: string; handover_requested_at: string | null; receiver_id: string };
      setTxStatus((prev) => (prev === row.status ? prev : row.status));
      setHandoverRequestedAt((prev) => (prev === row.handover_requested_at ? prev : row.handover_requested_at));
      if (row.handover_requested_at && row.receiver_id === meId && row.status === "pending") {
        setShowReceiverConfirm(true);
      }
      if (row.status === "completed") {
        setShowReview(true);
      }
    };
    fetchTx();
    const channel = supabase
      .channel(`tx-${transactionId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "transactions", filter: `id=eq.${transactionId}` },
        () => { fetchTx(); },
      )
      .subscribe();
    // Fallback polling — на случай если realtime не доставил
    const pollId = setInterval(fetchTx, 4000);
    return () => {
      alive = false;
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [transactionId, meId]);

  // загрузка сообщений + realtime + polling fallback
  useEffect(() => {
    if (!chatId || !meId) return;
    let cancelledLocal = false;
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, sender_id, content, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (cancelledLocal || !data) return;
      const next: Msg[] = data.map((m) => ({
        id: m.id as string,
        from: (m.sender_id === meId ? "me" : "them") as "me" | "them",
        text: m.content as string,
        ts: new Date(m.created_at as string).getTime(),
      }));
      setMessages((prev) => {
        if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id)) {
          return prev;
        }
        return next;
      });
    };
    fetchMessages();
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
    const pollId = setInterval(fetchMessages, 3500);
    return () => {
      cancelledLocal = true;
      clearInterval(pollId);
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

  const handleCancelBySender = async () => {
    if (cancelled || handedOver) return;
    try {
      await cancelBySenderFn({ data: { transaction_id: transactionId } });
    } catch (e) {
      toast.error("Не удалось отказаться", {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    toast.success("Вы отказались от дарения", {
      description: "Подарок снова в активных, баллы возвращены получателю",
    });
    setTimeout(() => navigate({ to: "/cabinet" }), 800);
  };

  const hints = isOwner ? OWNER_HINTS : RECEIVER_HINTS;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background">
      {/* Шапка */}
      <div className="border-b bg-card/60 px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            aria-label="Назад"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base text-muted-foreground transition hover:bg-muted"
          >
            ←
          </button>

          {/* Левая часть строки: фото + даритель/подарок. Ведёт на профиль,
              где можно посмотреть подарок подробнее. */}
          {(() => {
            const thumb = gift?.image_url ? (
              <img src={gift.image_url} alt={gift.title} className="h-11 w-11 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">🎁</div>
            );
            const info = (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">
                  {isOwner ? "Получатель" : "Даритель"}
                  {partner ? `: ${partner.name}` : ""}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  🎁 {gift?.title ?? "Подарок"}
                  {gift?.description ? ` — ${gift.description}` : ""}
                </div>
              </div>
            );
            return partner ? (
              <Link
                to="/user/$userId"
                params={{ userId: partner.id }}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl transition active:scale-[0.99]"
              >
                {thumb}
                {info}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {thumb}
                {info}
              </div>
            );
          })()}

          {/* Справа: небольшая приглушённо-красная кнопка отказа (для получателя) */}
          {!isOwner && !cancelled && !handedOver && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="shrink-0 rounded-full border border-red-300/70 px-2.5 py-1 text-[11px] font-medium text-red-500/90 transition hover:bg-red-50 active:scale-95">
                  Отказаться
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Отказаться от подарка?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Замороженные баллы вернутся вам, а подарок снова станет доступным другим.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCancel}>Отказаться</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {gift?.image_urls && gift.image_urls.length > 1 && (
          <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {gift.image_urls.map((src, i) => (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
              >
                <img
                  src={src}
                  alt={`Фото ${i + 1}`}
                  className="h-16 w-16 rounded-lg object-cover ring-1 ring-border"
                />
              </a>
            ))}
          </div>
        )}


        {/* Кнопки действия дарителя (у получателя «Отказаться» — в шапке справа) */}
        {isOwner && !cancelled && !handedOver && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!!handoverRequestedAt}
              onClick={handleRequestHandover}
              className="h-9 flex-1 rounded-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
            >
              <Check className="mr-1 h-4 w-4" />
              {handoverRequestedAt ? "Ожидаем подтверждения…" : "Подтвердить передачу"}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-9 flex-1 rounded-full bg-red-600 text-white shadow-sm hover:bg-red-700"
                >
                  <X className="mr-1 h-4 w-4" /> Отказаться от дарения
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Отказаться от дарения?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Подарок снова станет активным, а замороженные баллы вернутся получателю.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCancelBySender}>Подтвердить</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* Сообщения: я — зелёный с белым текстом, собеседник — белый с тёмным */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Поздоровайтесь — выберите готовое сообщение или напишите своё
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
              m.from === "me"
                ? "bg-emerald-600 text-white"
                : "bg-card text-foreground border"
            }`}>
              <Linkified text={m.text} isMe={m.from === "me"} />
            </div>
          </div>
        ))}
      </div>

      {/* Нижняя панель: шаблоны (видны сразу, без прокрутки) + поле ввода */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] z-30 border-t-2 border-emerald-600/30 bg-card px-3 pb-3 pt-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)]">
        {!handedOver && !cancelled && (
          <div className="mb-2 grid grid-cols-2 gap-2" data-tour="chat-templates">
            {hints.map((s) => (
              <button
                key={s}
                onClick={() => {
                  // если шаблон заканчивается на "…" — даём пользователю дописать
                  if (s.trim().endsWith("…")) {
                    setText(s);
                  } else {
                    send(s);
                  }
                }}
                disabled={!chatId}
                className="min-h-[48px] rounded-2xl border bg-background px-3 py-2 text-left text-[11.5px] leading-snug transition hover:bg-accent active:scale-[0.98] disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(text); }}
            placeholder="Напишите сообщение…"
            className="h-12 flex-1 rounded-full border-2 border-border bg-background px-5 text-base outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
          />
          <Button
            size="icon"
            className="h-12 w-12 shrink-0 rounded-full bg-emerald-600 text-white shadow-md hover:bg-emerald-700"
            onClick={() => send(text)}
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
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
          role={isOwner ? "giver" : "receiver"}
          claimedCondition={gift?.condition ?? null}
          onSubmit={async ({ label, comment, rating, isAuto, conditionConfirmed, proofPhoto }) => {
            const fullComment = [label, comment].filter(Boolean).join(" — ");
            // target_id: получатель оценивает дарителя, даритель оценивает получателя
            let targetId: string | null = null;
            if (isOwner) {
              // нужно вытащить receiver_id из транзакции
              const { data: tx } = await supabase
                .from("transactions")
                .select("receiver_id")
                .eq("id", transactionId)
                .maybeSingle();
              targetId = (tx?.receiver_id as string) ?? null;
            } else {
              targetId = gift?.owner_id ?? null;
            }
            try {
              if (targetId) {
                let proofUrl: string | null = null;
                if (proofPhoto) {
                  try {
                    proofUrl = await uploadImage(proofPhoto);
                  } catch {
                    /* фото-подтверждение не критично */
                  }
                }
                await reviewFn({
                  data: {
                    transaction_id: transactionId,
                    target_id: targetId,
                    rating,
                    comment: fullComment || undefined,
                    is_auto: isAuto,
                    condition_confirmed: conditionConfirmed ?? null,
                    proof_image_url: proofUrl,
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
