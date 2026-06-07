import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { publishWish } from "@/lib/wishes.functions";
import { haptic } from "@/lib/haptics";
import { uploadImages } from "@/lib/upload-image";

interface Props {
  onDone: (wishId: string) => void;
  onBack: () => void;
}

const CATEGORIES = [
  "разное",
  "вещь",
  "одежда",
  "книги",
  "техника",
  "услуга",
  "встреча",
  "опыт",
];

// Простое сжатие фото до data URL (~max 1280px, jpeg 0.8)
const compressImage = (dataUrl: string, maxSize = 1280, quality = 0.8): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxSize || h > maxSize) {
        const r = Math.min(maxSize / w, maxSize / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

export function WishForm({ onDone, onBack }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("разное");
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const publishFn = useServerFn(publishWish);

  const MAX_PHOTOS = 10;

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const slots = Math.max(0, MAX_PHOTOS - photoPreviews.length);
    const toRead = files.slice(0, slots);
    if (slots === 0) {
      toast.error(`Можно загрузить максимум ${MAX_PHOTOS} фото`);
      e.target.value = "";
      return;
    }
    Promise.all(
      toRead.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async () => {
              const dataUrl = await compressImage(String(reader.result));
              resolve(dataUrl);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(f);
          }),
      ),
    )
      .then((urls) => setPhotoPreviews((prev) => [...prev, ...urls]))
      .catch(() => toast.error("Не удалось загрузить фото"));
    e.target.value = "";
  };

  const removePhoto = (idx: number) =>
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Напиши, что хочешь получить ✨");
      return;
    }
    setLoading(true);
    try {
      const { id } = await publishFn({
        data: {
          title: title.trim(),
          description: description.trim() || null,
          category,
          image_url: photoPreviews[0] ?? null,
          image_urls: photoPreviews,
        },
      });
      haptic("success");
      onDone(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("INSUFFICIENT_BALANCE")) {
        toast.error("Недостаточно баллов", {
          description: "Для размещения пожелания нужно 0.2 балла",
        });
      } else {
        toast.error("Не получилось разместить", { description: msg });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <button onClick={onBack} className="mb-4 text-sm text-muted-foreground hover:text-foreground">
        ← Назад
      </button>

      <Card className="border-primary/20 bg-card/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">✨ Загадай желание</CardTitle>
          <CardDescription>
            Опиши, что хочешь получить. Кто-нибудь увидит и принесёт.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Что ищешь?</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Книга Достоевского «Идиот»"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>Подробнее (необязательно)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Любой состояние, можно б/у, в районе м. Тимирязевская…"
              maxLength={2000}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Категория</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    category === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Фото-референс (необязательно, до 10 шт.)</Label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📷 Сделать фото
                <input type="file" accept="image/*" capture="environment" multiple onChange={onPhoto} className="hidden" />
              </label>
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📁 Выбрать файлы
                <input type="file" accept="image/*" multiple onChange={onPhoto} className="hidden" />
              </label>
            </div>
            {photoPreviews.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {photoPreviews.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt={`Превью ${i + 1}`} className="h-24 w-full rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/95 text-xs shadow ring-1 ring-border hover:bg-destructive hover:text-destructive-foreground"
                      aria-label="Удалить фото"
                    >
                      ✕
                    </button>
                    {i === 0 && (
                      <span className="absolute bottom-1 left-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                        обложка
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>


          <Button onClick={submit} disabled={loading} className="w-full rounded-2xl">
            {loading ? "Отправляем…" : "✨ Загадать желание"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
