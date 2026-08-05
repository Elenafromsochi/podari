import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircleQuestion, X, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askAssistant } from "@/lib/assistant.functions";
import { haptic } from "@/lib/haptics";

type Msg = { role: "user" | "assistant"; content: string };

const STARTERS = ["Как получить подарок?", "Что такое баллы?", "Как пригласить друга?"];

/**
 * Плавающая кнопка-помощник, видна на любом экране (как GlobalNotifications/
 * TourOverlay в __root.tsx). История диалога — только на время сессии,
 * в состоянии компонента; ничего не пишем в БД (см. план v1).
 */
export function AssistantWidget() {
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const askFn = useServerFn(askAssistant);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSignedIn(!!data.session?.user?.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user?.id);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    haptic("select");
    const history = messages.slice(-8);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setText("");
    setBusy(true);
    try {
      const res = await askFn({ data: { message: q, history } });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Сейчас не получилось ответить — попробуй ещё раз чуть позже 🙏",
        },
      ]);
      console.error("[AssistantWidget] askAssistant failed", e);
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic("select");
          setOpen(true);
        }}
        aria-label="Помощник «Подари»"
        className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition active:scale-95 hover:brightness-105"
      >
        <MessageCircleQuestion className="h-6 w-6" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 sm:items-center"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-background shadow-xl sm:h-[80dvh] sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-base font-semibold">🤖 Помощник «Подари»</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Закрыть"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
                {messages.length === 0 && (
                  <>
                    <p className="text-center text-sm text-muted-foreground">
                      Спроси что-нибудь о том, как работает «Подари» 💚
                    </p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {STARTERS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => ask(s)}
                          className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition active:scale-95 hover:bg-accent"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        m.role === "user"
                          ? "bg-primary text-white"
                          : "border bg-card text-foreground"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1.5 rounded-2xl border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Думаю…
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t bg-card px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        ask(text);
                      }
                    }}
                    placeholder="Спроси о сервисе…"
                    rows={1}
                    maxLength={500}
                    className="min-h-[40px] flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => ask(text)}
                    disabled={busy || !text.trim()}
                    aria-label="Отправить"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
