import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { publishWish } from "@/lib/wishes.functions";
import { classifyWishCategory, generateGiftImage } from "@/lib/gift-ai.functions";
import { COST_TIERS } from "@/lib/gift-kinds";
import { haptic } from "@/lib/haptics";
import { uploadImages } from "@/lib/upload-image";

interface Props {
  onDone: (wishId: string, hidden?: boolean) => void;
  onBack: () => void;
  userLevel: number;
}

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

export function WishForm({ onDone, onBack, userLevel }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [link, setLink] = useState("");
  const [hidden, setHidden] = useState(false);
  const [cost, setCost] = useState<number>(1);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Город (подставляется из прошлой публикации) + флаг «откуда угодно / онлайн».
  const [city, setCity] = useState<string>(() =>
    typeof localStorage !== "undefined" ? (localStorage.getItem("cozygift_city") ?? "") : "",
  );
  const [isOnline, setIsOnline] = useState(false);
  // Когда человек ставит курсор в поле — текст-пример (placeholder) убираем,
  // чтобы поле выглядело пустым и готовым к своему тексту.
  const [titleFocus, setTitleFocus] = useState(false);
  const [descFocus, setDescFocus] = useState(false);
  const publishFn = useServerFn(publishWish);
  const classifyFn = useServerFn(classifyWishCategory);
  const genImageFn = useServerFn(generateGiftImage);
  const [genImg, setGenImg] = useState(false);

  const MAX_PHOTOS = 10;

  // Нарисовать картинку-референс по тексту желания (как у подарков без фото).
  const handleGenImage = async () => {
    const text = `${title.trim()}. ${description.trim()}`.trim();
    if (!title.trim()) {
      toast.error("Сначала напиши, что хочешь получить — ИИ нарисует картинку ✨");
      return;
    }
    setGenImg(true);
    try {
      const { imageDataUrl } = await genImageFn({
        data: { title: title.trim(), description: text },
      });
      setPhotoPreviews((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, imageDataUrl]));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось нарисовать картинку");
    } finally {
      setGenImg(false);
    }
  };

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

  const removePhoto = (idx: number) => setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Напиши, что хочешь получить ✨");
      return;
    }
    setLoading(true);
    try {
      const uploadedUrls = await uploadImages(photoPreviews);
      // Категорию подбирает ИИ по тексту желания — пользователю выбирать не нужно.
      let category = "разное";
      try {
        const res = await classifyFn({
          data: { text: `${title.trim()}. ${description.trim()}`.slice(0, 2000) },
        });
        category = res?.category || "разное";
      } catch {
        /* ИИ недоступен — оставляем «разное», не мешаем загадать желание */
      }
      const { id } = await publishFn({
        data: {
          title: title.trim(),
          description: description.trim() || null,
          category,
          cost,
          image_url: uploadedUrls[0] ?? null,
          image_urls: uploadedUrls,
          city: isOnline ? null : city.trim() || null,
          is_online: isOnline,
          link: link.trim() || null,
          hidden,
        },
      });
      if (!isOnline && city.trim() && typeof localStorage !== "undefined") {
        try {
          localStorage.setItem("cozygift_city", city.trim());
        } catch {
          /* noop */
        }
      }
      haptic("success");
      onDone(id, hidden);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Не получилось разместить", { description: msg });
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
              onFocus={() => setTitleFocus(true)}
              onBlur={() => setTitleFocus(false)}
              placeholder={titleFocus ? "" : "Например: Книга Достоевского «Идиот»"}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>Подробнее (необязательно)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onFocus={() => setDescFocus(true)}
              onBlur={() => setDescFocus(false)}
              placeholder={
                descFocus ? "" : "Любое состояние, можно б/у, в районе м. Тимирязевская…"
              }
              maxLength={2000}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Ссылка на подарок (необязательно)</Label>
            <Input
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Ссылка на товар или пример, напр. wildberries.ru/…"
              maxLength={2000}
            />
            <p className="text-[11px] text-muted-foreground">
              Можно вставить ссылку на конкретный товар — так дарителю понятнее, что именно ты хочешь.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Во сколько баллов оцениваешь желание?</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {COST_TIERS.map((t) => {
                const active = cost === t.cost;
                // Стоимость ограничена уровнем — как и у подарков: на 1 уровне
                // можно обещать только 1 балл, выше — больше.
                const locked = t.cost > userLevel;
                return (
                  <button
                    key={t.cost}
                    type="button"
                    onClick={() => {
                      if (locked) {
                        toast(`🔒 ${t.cost} ${t.cost < 5 ? "балла" : "баллов"}`, {
                          description: `Откроется на ${t.cost} уровне. Дари и получай — и дойдёшь сюда!`,
                        });
                        return;
                      }
                      setCost(t.cost);
                    }}
                    aria-disabled={locked}
                    className={`flex flex-col items-center rounded-xl border-2 px-1 py-2 text-[11px] font-medium transition ${
                      locked
                        ? "cursor-not-allowed border-input bg-muted/40 text-muted-foreground/50"
                        : active
                          ? "border-emerald-500 bg-emerald-100 text-emerald-800 shadow-sm"
                          : "border-input bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span className="text-sm font-semibold">{locked ? "🔒" : t.cost}</span>
                    <span className="text-[9px] opacity-70">
                      {locked
                        ? `ур. ${t.cost}`
                        : t.cost === 1
                          ? "балл"
                          : t.cost < 5
                            ? "балла"
                            : "баллов"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Загадать — бесплатно. Эти баллы спишутся у тебя и достанутся тому, кто исполнит
              желание — уже когда подтвердишь, что всё получил 💚
            </p>
          </div>

          {/* Город / онлайн */}
          <div className="space-y-2">
            <Label htmlFor="wish-city">Город</Label>
            <Input
              id="wish-city"
              value={isOnline ? "" : city}
              onChange={(e) => setCity(e.target.value)}
              disabled={isOnline}
              placeholder="Например, Сочи"
              maxLength={80}
            />
            {!isOnline && (
              <div className="flex flex-wrap gap-1.5">
                {["Сочи", "Краснодар", "Москва", "Санкт-Петербург"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCity(c)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      city === c
                        ? "border-emerald-500 bg-emerald-100 text-emerald-800"
                        : "border-input bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={isOnline}
                onChange={(e) => setIsOnline(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className="font-medium">🌐 Можно онлайн / из любого города</span>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Укажи город — дарители рядом увидят, кому помочь. Если вещь/услугу можно получить
              онлайн или откуда угодно — поставь галочку.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Фото-референс (необязательно, до 10 шт.)</Label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📷 Сделать фото
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={onPhoto}
                  className="hidden"
                />
              </label>
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📁 Выбрать файлы
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onPhoto}
                  className="hidden"
                />
              </label>
            </div>
            {photoPreviews.length === 0 && (
              <>
                <button
                  type="button"
                  onClick={handleGenImage}
                  disabled={genImg || !title.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 py-2.5 text-sm font-medium text-primary transition active:scale-[0.98] disabled:opacity-50"
                >
                  {genImg ? "🎨 ИИ рисует…" : "🎨 Нарисовать картинку по описанию"}
                </button>
                <p className="text-[11px] text-muted-foreground">
                  Нет фото? Опиши, что хочешь — и ИИ нарисует картинку-референс.
                </p>
              </>
            )}
            {photoPreviews.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {photoPreviews.map((src, i) => (
                  <div key={i} className="relative">
                    <img
                      src={src}
                      alt={`Превью ${i + 1}`}
                      className="h-24 w-full rounded-lg object-cover"
                    />
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

          <label className="flex cursor-pointer items-start gap-2 rounded-2xl border border-input bg-background px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-emerald-600"
            />
            <span>
              <span className="font-medium">🌌 Скрыть желание — «во Вселенную»</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Никто не увидит его в ленте. Оно останется у тебя в «Моих желаниях» —
                можно открыть для всех в любой момент одной кнопкой.
              </span>
            </span>
          </label>

          <Button onClick={submit} disabled={loading} className="w-full rounded-2xl">
            {loading ? "Отправляем…" : hidden ? "🌌 Отправить во Вселенную" : "✨ Загадать желание"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
