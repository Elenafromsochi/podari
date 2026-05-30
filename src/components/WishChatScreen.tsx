import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
import { sendChatMessage } from "@/lib/cozy.functions";
import {
  cancelWishClaim,
  confirmWishReceived,
  requestWishHandover,
} from "@/lib/wishes.functions";

type Msg = { id: string; from: "me" | "them"; text: string; ts: number };
type Wish = { id: string; title: string; image_url: string | null; owner_id: string };

const AUTO_MSGS_GIVER = [
  "Здравствуйте! Я могу исполнить ваше пожелание ✨",
  "Расскажите, когда и где удобно передать?",
];
const AUTO_MSGS_WISHER = [
  "Спасибо большое! 💚",
  "Когда вам будет удобно встретиться?",
];

interface Props {
  wishId: string;
  transactionId: string;
  onBack: () => void;
  onCompleted: () => void;
}

export function WishChatScreen({ wishId, transactionId, onBack, onCompleted }: Props) {
  const [wish, setWish] = useState<Wish | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [partner, setPartner] = useState<{ id: string; name: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [txStatus, setTxStatus] = useState<string>("pending");
  const [handoverAt, setHandoverAt] = useState<string | null>(null);
  const [showWisherConfirm, setShowWisherConfirm] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sendMessageFn = useServerFn(sendChatMessage);
  const requestFn = useServerFn(requestWishHandover);
  const confirmFn = useServerFn(confirmWishReceived);
  const cancelFn = useServerFn(cancelWishClaim);

  const isWisher = !!(meId && wish && wish.owner_id === meId);
  const completed = txStatus === "completed";
  const cancelled = txStatus === "cancelled";

  // load wish, me, chat
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const myId = u.user?.id ?? null;
      setMeId(myId);
      const { data: w } = await supabase
        .from("wishes")
        .select("id,title,image_url,owner_id")
        .eq("id", wishId)
        .maybeSingle();
      setWish(w as Wish | null);
      if (myId) {
        const { data: chat } = await supabase
          .from("chats")
          .select("id")
          .eq("wish_id", wishId)
          .or(`user_a.eq.${myId},user_b.eq.${myId}`)
          .maybeSingle();
        if (chat?.id) setChatId(chat.id as string);
      }
    })();
  }, [wishId]);

  // partner
  useEffect(() => {
    if (!meId || !wish || !transactionId) return;
    (async () => {
      const { data: tx } = await supabase
        .from("wish_transactions")
        .select("wisher_id,giver_id")
        .eq("id", transactionId)
        .maybeSingle();
      const row = tx as { wisher_id: string; giver_id: string } | null;
      if (!row) return;
      const partnerId = row.wisher_id === meId ? row.giver_id : row.wisher_id;
      const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: [partnerId] });
      const list = (profs ?? []) as Array<{ user_id: string; display_name: string }>;
      setPartner({ id: partnerId, name: list[0]?.display_name || "Гость" });
    })();
  }, [meId, wish, transactionId]);

  // tx state
  useEffect(() => {
    if (!transactionId || !meId) return;
    let alive = true;
    const fetchTx = async () => {
      const { data } = await supabase
        .from("wish_transactions")
        .select("status, handover_requested_at, wisher_id")
        .eq("id", transactionId)
        .maybeSingle();
      if (!alive || !data) return;
      const row = data as { status: string; handover_requested_at: string | null; wisher_id: string };
      setTxStatus((p) => (p === row.status ? p : row.status));
      setHandoverAt((p) => (p === row.handover_requested_at ? p : row.handover_requested_at));
      if (row.handover_requested_at && row.wisher_id === meId && row.status === "pending") {
        setShowWisherConfirm(true);
      }
      if (row.status === "completed") {
        onCompleted();
      }
    };
    fetchTx();
    const channel = supabase
      .channel(`wishtx-${transactionId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wish_transactions", filter: `id=eq.${transactionId}` },
        () => { fetchTx(); },
      )
      .subscribe();
    const poll = setInterval(fetchTx, 4000);
    return () => {
      alive = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [transactionId, meId, onCompleted]);

  // messages
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
      setMessages((prev) =>
        prev.length === next.length && prev.every((p, i) => p.id === next[i].id) ? prev : next,
      );
    };
    fetchMessages();
    const channel = supabase
      .channel(`wishmsg-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        () => { fetchMessages(); },
      )
      .subscribe();
    const poll = setInterval(fetchMessages, 3500);
    return () => {
      cancelledLocal = true;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [chatId, meId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || !chatId) return;
    setText("");
    try {
      const ins = await sendMessageFn({ data: { chat_id: chatId, content: t } });
      if (ins?.id) {
        setMessages((prev) =>
          prev.some((x) => x.id === ins.id)
            ? prev
            : [...prev, {
                id: ins.id as string,
                from: "me",
                text: ins.content as string,
                ts: new Date(ins.created_at as string).getTime(),
              }],
        );
      }
    } catch (e) {
      setText(t);
      toast.error("Не удалось отправить", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleRequest = async () => {
    try {
      await requestFn({ data: { transaction_id: transactionId } });
      setHandoverAt(new Date().toISOString());
      toast.success("Запрос подтверждения отправлен");
    } catch (e) {
      toast.error("Не получилось", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleConfirm = async () => {
    setShowWisherConfirm(false);
    try {
      await confirmFn({ data: { transaction_id: transactionId } });
      toast.success("Подтверждено! Спасибо 💚", {
        description: "−0.8 балла, +10 опыта тебе. Дарителю +1 балл, +80 опыта",
      });
    } catch (e) {
      toast.error("Не получилось подтвердить", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleCancel = async () => {
    if (!confirm("Отменить эту сделку?")) return;
    try {
      await cancelFn({ data: { transaction_id: transactionId } });
      toast("Сделка отменена");
      onBack();
    } catch (e) {
      toast.error("Не получилось", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const autoMsgs = isWisher ? AUTO_MSGS_WISHER : AUTO_MSGS_GIVER;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          ←
        </button>
        {wish?.image_url ? (
          <img src={wish.image_url} alt={wish.title} className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-peach/40">✨</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {isWisher ? "Чат с дарителем" : "Чат с пожелателем"}
            {partner && (
              <>
                {": "}
                <Link
                  to="/user/$userId"
                  params={{ userId: partner.id }}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {partner.name}
                </Link>
              </>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">✨ {wish?.title ?? "Пожелание"}</div>
        </div>
        {isWisher ? (
          <Button
            size="sm"
            variant="outline"
            disabled={completed || cancelled || !handoverAt}
            onClick={() => setShowWisherConfirm(true)}
            className="rounded-full"
          >
            <Check className="h-4 w-4" />
            {completed ? "Получено" : "Получено"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={completed || cancelled || !!handoverAt}
            onClick={handleRequest}
            className="rounded-full"
          >
            <Check className="h-4 w-4" />
            {completed ? "Передано" : handoverAt ? "Ожидаем..." : "Я передал"}
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Поздоровайтесь — обсудите детали передачи
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                m.from === "me" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {!completed && !cancelled && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2">
          {autoMsgs.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={!chatId}
              className="shrink-0 rounded-full border bg-card px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              {s}
            </button>
          ))}
          {!completed && !cancelled && !handoverAt && (
            <button
              onClick={handleCancel}
              className="shrink-0 rounded-full border bg-card px-3 py-1.5 text-xs text-destructive hover:bg-accent"
            >
              <X className="mr-1 inline h-3 w-3" />
              Отменить сделку
            </button>
          )}
        </div>
      )}

      <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t-2 border-primary/20 bg-card px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(text); }}
          placeholder="Напишите сообщение…"
          className="h-12 flex-1 rounded-full border-2 border-border bg-background px-5 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <Button size="icon" className="h-12 w-12 shrink-0 rounded-full shadow-md" onClick={() => send(text)}>
          <Send className="h-5 w-5" />
        </Button>
      </div>

      <AlertDialog open={showWisherConfirm} onOpenChange={setShowWisherConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Пожелание исполнено?</AlertDialogTitle>
            <AlertDialogDescription>
              Подтверди получение «{wish?.title ?? ""}». С твоего счёта спишется −0.8 балла,
              а дарителю придёт +1 балл и +80 опыта.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ещё нет</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Да, получил(а)</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
