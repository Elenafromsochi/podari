import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { publishWish } from "@/lib/wishes.functions";
import { generateWishMeta, summarizeWishDescription, generateGiftImage } from "@/lib/gift-ai.functions";
import { COST_TIERS } from "@/lib/gift-kinds";
import { haptic } from "@/lib/haptics";
import { uploadImages } from "@/lib/upload-image";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";
import { WISH_EXAMPLES, nextExamplePlaceholder } from "@/lib/random-copy";

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
  // Одно поле вместо «Название» + «Подробнее» — как в форме подарка,
  // название ИИ придумывает сам по этому тексту при публикации.
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
  // Пример каждый раз другой — по кругу без повторов.
  const [examplePlaceholder] = useState(() => nextExamplePlaceholder("wish", WISH_EXAMPLES));
  const publishFn = useServerFn(publishWish);
  const metaFn = useServerFn(generateWishMeta);
  const summarizeFn = useServerFn(summarizeWishDescription);
  const genImageFn = useServerFn(generateGiftImage);
  const [genImg, setGenImg] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  // Голос: та же запись + распознавание, что и в форме подарка.
  const voice = useVoiceRecorder((text) =>
    setDescription((prev) => (prev ? prev.trim() + " " : "") + text),
  );

  const MAX_PHOTOS = 10;

  // Таймер записи для отображения «Запись 0:07».
  useEffect(() => {
    if (voice.status !== "recording") return;
    setRecSeconds(0);
    const id = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [voice.status]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // «Улучшить с ИИ» у желаний, в отличие от подарков, СЖИМАЕТ текст —
  // человек часто надиктовывает длинно и путано, нужна ясная суть, а не ещё текст.
  const summarizeDescription = async () => {
    const text = description.trim();
    if (!text) {
      toast.error("Сначала напиши, что хочешь получить ✨");
      return;
    }
    setSummarizing(true);
    try {
      const { description: better } = await summarizeFn({ data: { text } });
      setDescription(better);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось улучшить текст");
    } finally {
      setSummarizing(false);
    }
  };

  // Нарисовать картинку-референс по тексту желания (как у подарков без фото).
  const handleGenImage = async () => {
    const text = description.trim();
    if (!text) {
      toast.error("Сначала напиши, что хочешь получить — ИИ нарисует картинку ✨");
      return;
    }
    setGenImg(true);
    try {
      const { imageDataUrl } = await genImageFn({ data: { description: text } });
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
    const text = description.trim();
    if (!text) {
      toast.error("Напиши, что хочешь получить ✨");
      return;
    }
    setLoading(true);
    try {
      const uploadedUrls = await uploadImages(photoPreviews);
      // Название и категорию придумывает ИИ по тексту желания — как у подарков,
      // отдельное поле «Название» не нужно. Если ИИ недоступен — берём первые
      // слова текста, чтобы публикация всё равно прошла.
      let title = "";
      let category = "разное";
      try {
        const meta = await metaFn({ data: { description: text } });
        title = meta.title;
        category = meta.category;
      } catch {
        const words = text.replace(/\s+/g, " ").split(" ").slice(0, 6).join(" ");
        title = (words || "Желание").slice(0, 80);
      }
      const { id } = await publishFn({
        data: {
          title,
          description: text,
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
            <div className="flex gap-2">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={examplePlaceholder}
                maxLength={2000}
                rows={4}
                className="flex-1 placeholder:italic placeholder:text-muted-foreground/60"
              />
              <button
                type="button"
                onClick={voice.toggle}
                disabled={voice.status === "transcribing"}
                aria-label={voice.status === "recording" ? "Остановить запись" : "Голосовой ввод"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-lg transition-all ${
                  voice.status === "recording"
                    ? "animate-pulse border-destructive bg-destructive text-destructive-foreground shadow-md"
                    : "border-input bg-background hover:bg-accent"
                }`}
              >
                {voice.status === "recording" ? "⏹" : voice.status === "transcribing" ? "⏳" : "🎙️"}
              </button>
            </div>
            {voice.status === "recording" ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
                </span>
                <span className="font-medium">Запись {formatTime(recSeconds)}</span>
                <span className="ml-auto text-destructive/80">Нажми ⏹, когда закончишь</span>
              </div>
            ) : voice.status === "transcribing" ? (
              <p className="text-xs text-muted-foreground">⏳ Распознаём речь…</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Или нажми 🎙️ и надиктуй, что хочешь — текст подставится сам.
              </p>
            )}
            {voice.error && <p className="text-xs text-amber-600">{voice.error}</p>}
            <button
              type="button"
              onClick={summarizeDescription}
              disabled={summarizing || !description.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 py-2 text-sm font-medium text-primary transition active:scale-[0.98] disabled:opacity-50"
            >
              {summarizing ? "✨ ИИ сокращает…" : "✨ Улучшить с ИИ"}
            </button>
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
                  disabled={genImg || !description.trim()}
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

          <div className="space-y-2">
            <Label>Ссылка на товар (необязательно)</Label>
            <Input
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Например, wildberries.ru/…"
              maxLength={2000}
            />
            <p className="text-[11px] text-muted-foreground">
              Можно вставить ссылку на конкретный товар — так дарителю понятнее, что именно ты хочешь.
              Картинку с сайта пока не подтягиваем автоматически — добавь фото или ИИ-референс выше.
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
                          ? "border-primary bg-primary/10 text-primary shadow-sm"
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
                        ? "border-primary bg-primary/10 text-primary"
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
                className="h-4 w-4 accent-primary"
              />
              <span className="font-medium">🌐 Можно онлайн / из любого города</span>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Укажи город — дарители рядом увидят, кому помочь. Если вещь/услугу можно получить
              онлайн или откуда угодно — поставь галочку.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-2xl border border-input bg-background px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
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
