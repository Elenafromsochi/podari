import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Inbox, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listAdminMessages, setAdminMessageStatus } from "@/lib/admin-messages.functions";

type Msg = Awaited<ReturnType<typeof listAdminMessages>>[number];

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
                <span className="text-xs font-medium text-zinc-300">{m.user_name}</span>
                <span className="text-[10px] text-zinc-500">
                  {new Date(m.created_at).toLocaleString("ru-RU")}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-zinc-100">{m.content}</p>
              {m.image_url && (
                <a href={m.image_url} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                  <img
                    src={m.image_url}
                    alt="скрин"
                    className="max-h-56 rounded-lg border border-white/10 object-cover"
                  />
                </a>
              )}
              <div className="mt-2 flex justify-end">
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
