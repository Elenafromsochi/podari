import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageSquarePlus, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { sendAdminMessage } from "@/lib/admin-messages.functions";
import { haptic } from "@/lib/haptics";

export function WriteToAdminButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendFn = useServerFn(sendAdminMessage);

  const reset = () => {
    setText("");
    setFile(null);
    setPreview(null);
  };

  const onPick = (f: File | null) => {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      toast.error("Файл слишком большой (макс 8 МБ)");
      return;
    }
    if (!f.type.startsWith("image/")) {
      toast.error("Только изображения");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!text.trim()) {
      toast.error("Напиши сообщение");
      return;
    }
    setSending(true);
    try {
      let image_path: string | null = null;
      if (file) {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) throw new Error("Не авторизован");
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${uid}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("admin-uploads")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw new Error(upErr.message);
        image_path = path;
      }
      await sendFn({ data: { content: text.trim(), image_path } });
      haptic("success");
      toast.success("Спасибо! Сообщение отправлено админу 💌");
      reset();
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Не удалось отправить", { description: msg });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-tour="admin-btn"
          onClick={() => haptic("select")}
          className="inline-flex items-center gap-1.5 rounded-full bg-lavender/60 px-3 py-1.5 text-xs font-medium text-lavender-foreground transition active:scale-95"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Админу
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Написать админу</DialogTitle>
          <DialogDescription>
            Поделись пожеланием или сообщи о проблеме. Можно приложить скриншот.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Опиши, что нужно — идею, баг или пожелание"
            maxLength={4000}
            rows={5}
            className="resize-none"
          />

          {preview ? (
            <div className="relative">
              <img src={preview} alt="превью" className="max-h-48 w-full rounded-xl object-cover" />
              <button
                type="button"
                onClick={() => { setFile(null); setPreview(null); }}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground shadow"
                aria-label="Убрать"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
              <ImageIcon className="h-4 w-4" />
              Прикрепить скриншот
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={sending}>
            {sending ? "Отправляем…" : "Отправить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
