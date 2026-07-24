import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Inbox, Check, RotateCcw, Send, CornerDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listAdminMessages, setAdminMessageStatus, replyAdminMessage } from "@/lib/admin-messages.functions";

type Msg = Awaited<ReturnType<typeof listAdminMessages>>[number];

// Делает ссылки (профиль, t.me, чат сделки) кликабельными — чтобы админ мог
// сразу открыть Telegram участника или его профиль прямо из заявки о споре.
function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-zinc-100">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-300 underline underline-offset-2 break-all hover:text-indigo-200"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

function ReplyBox({ msg, onSent }: { msg: Msg; onSent: (id: string, text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const replyFn = useServerFn(replyAdminMessage);

  const submit = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await replyFn({ data: { id: msg.id, text: text.trim() } });
      toast.success("Ответ отправлен в Telegram 💌");
      onSent(msg.id, text.trim());
      setText("");
      setOpen(false);
    } catch (e: any) {
      const m = e?.message ?? "";
      if (m.includes("NO_TELEGRAM")) toast.error("У пользователя не привязан Telegram");
      else toast.error("Не удалось отправить ответ");
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="text-indigo-300 hover:bg-white/5 hover:text-indigo-200"
      >
        <CornerDownRight className="mr-1 h-3.5 w-3.5" /> Ответить
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Текст ответа — уйдёт человеку в Telegram-бота"
        rows={3}
        className="bg-white/5 border-white/10 text-zinc-100 text-sm"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="text-zinc-400 hover:text-white">
          Отмена
        </Button>
        <Button size="sm" onClick={submit} disabled={sending || !text.trim()} className="bg-indigo-500 hover:bg-indigo-400">
          {sending ? "Отправка…" : <><Send className="mr-1 h-3.5 w-3.5" /> Отправить</>}
        </Button>
      </div>
    </div>
  );
}

export function AdminInbox() {
  const listFn = useServerFn(listAdminMessages);
  const setStatusFn = useServerFn(setAdminMessageStatus);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await listFn({ data: { onlyNew } });
      setMsgs(r);
    } catch (e: any) {
      toast.error("Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyNew]);

  const toggle = async (m: Msg) => {
    const next = m.status === "new" ? "read" : "new";
    try {
      await setStatusFn({ data: { id: m.id, status: next } });
      setMsgs((prev) => prev?.map((x) => (x.id === m.id ? { ...x, status: next } : x)) ?? prev);
    } catch {
      toast.error("Не удалось обновить");
    }
  };

  const onReplied = (id: string, text: string) => {
    setMsgs((prev) =>
      prev?.map((x) =>
        x.id === id ? { ...x, status: "read", admin_reply: text, replied_at: new Date().toISOString() } : x,
      ) ?? prev,
    );
  };

  const unread = (msgs ?? []).filter((m) => m.status === "new").length;

  return (
    <section className="ins-card p-4 mb-5 ins-fade">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/15">
            <Inbox className="h-4 w-4 text-indigo-300" />
          </div>
          <div>
            <div className="text-sm font-semibold">Сообщения админу</div>
            <div className="text-xs text-zinc-500">
              {msgs ? `${msgs.length} всего · ${unread} новых` : "загрузка…"}
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Только новые
        </label>
      </div>

      {!msgs && loading ? (
        <div className="py-6 text-center text-xs text-zinc-500">Загрузка…</div>
      ) : (msgs ?? []).length === 0 ? (
        <div className="py-6 text-center text-xs text-zinc-500">Пока пусто</div>
      ) : (
        <ul className="space-y-2">
          {(msgs ?? []).map((m) => (
            <li
              key={m.id}
              className={`rounded-xl border p-3 ${
                m.status === "new"
                  ? "border-indigo-400/30 bg-indigo-500/5"
                  : "border-white/5 bg-white/5"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-zinc-300">{m.user_name}</span>
                  {m.telegram_username && (
                    <a
                      href={`https://t.me/${m.telegram_username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Написать @${m.telegram_username} в Telegram`}
                      aria-label="Написать в Telegram"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#229ED9]/20 text-[#229ED9] transition hover:bg-[#229ED9]/30"
                    >
                      <Send className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <span className="text-[10px] text-zinc-500">
                  {new Date(m.created_at).toLocaleString("ru-RU")}
                </span>
              </div>
              <LinkedText text={m.content} />
              {m.content.startsWith("🛑") && (
                <span className="mt-1 inline-block rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                  Спор по сделке
                </span>
              )}
              {m.image_url && (
                <a href={m.image_url} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                  <img
                    src={m.image_url}
                    alt="скрин"
                    className="max-h-56 rounded-lg border border-white/10 object-cover"
                  />
                </a>
              )}

              {m.admin_reply && (
                <div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-2">
                  <div className="mb-0.5 text-[10px] font-medium text-emerald-300">
                    Ваш ответ{m.replied_at ? ` · ${new Date(m.replied_at).toLocaleString("ru-RU")}` : ""}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs text-zinc-200">{m.admin_reply}</p>
                </div>
              )}

              <div className="mt-2 flex items-center justify-between">
                <ReplyBox msg={m} onSent={onReplied} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggle(m)}
                  className="text-zinc-300 hover:bg-white/5"
                >
                  {m.status === "new" ? (
                    <><Check className="mr-1 h-3.5 w-3.5" /> Прочитано</>
                  ) : (
                    <><RotateCcw className="mr-1 h-3.5 w-3.5" /> В новые</>
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
