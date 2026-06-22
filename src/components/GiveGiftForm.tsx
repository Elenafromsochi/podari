import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { publishGift, checkGiftCost } from "@/lib/cozy.functions";
import { generateGiftMeta, describeGiftImage, enhanceGiftDescription, generateGiftImage } from "@/lib/gift-ai.functions";
import { uploadImages } from "@/lib/upload-image";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";

import { COST_TIERS, hasCondition, type GiftKind } from "@/lib/gift-kinds";

interface Props {
  onDone: (giftId: string) => void;
  onBack: () => void;
  presetHint?: string | null;
  giftKind: GiftKind;
  userLevel: number;
}

export function GiveGiftForm({ onDone, onBack, presetHint, giftKind, userLevel }: Props) {
  // Сердечки/износ показываем только для вещей; у услуг и встреч их нет.
  const showCondition = hasCondition(giftKind);
  const initialDesc = presetHint ? `${presetHint}. ` : "";
  const [description, setDescription] = useState(initialDesc);
  // Текст-пример (подставленный из подсказки) убираем, как только человек
  // ставит курсор, чтобы он писал по-своему с чистого поля.
  const [presetCleared, setPresetCleared] = useState(false);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [cost, setCost] = useState<number>(1);
  const [condition, setCondition] = useState<number | null>(null);
  // Многоразовый подарок: можно подарить несколько раз (особенно услугу).
  const [multi, setMulti] = useState(false);
  const [quantity, setQuantity] = useState(3);
  // Город запоминаем локально из прошлой публикации (подставляем по умолчанию).
  const [city, setCity] = useState<string>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem("cozygift_city") ?? "" : "",
  );
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);

  // Голос: запись на устройстве + распознавание на сервере (работает в любом
  // браузере). Распознанный текст дописываем к описанию.
  const voice = useVoiceRecorder((text) =>
    setDescription((prev) => (prev ? prev.trim() + " " : "") + text),
  );

  const generateMeta = useServerFn(generateGiftMeta);
  const describeImage = useServerFn(describeGiftImage);
  const enhanceFn = useServerFn(enhanceGiftDescription);
  const genImageFn = useServerFn(generateGiftImage);
  const [enhancing, setEnhancing] = useState(false);
  const [genImg, setGenImg] = useState(false);

  const handleGenImage = async () => {
    const text = description.trim();
    if (!text) {
      setError("Сначала опиши подарок — по описанию ИИ нарисует картинку ✨");
      return;
    }
    setGenImg(true);
    setError(null);
    try {
      const { imageDataUrl } = await genImageFn({ data: { description: text } });
      setPhotoPreviews((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, imageDataUrl]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось нарисовать картинку");
    } finally {
      setGenImg(false);
    }
  };

  const enhanceDescription = async () => {
    const text = description.trim();
    if (!text) {
      setError("Сначала напиши пару слов о подарке ✨");
      return;
    }
    setEnhancing(true);
    setError(null);
    try {
      const { description: better } = await enhanceFn({ data: { text } });
      setDescription(better);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось дополнить");
    } finally {
      setEnhancing(false);
    }
  };
  const publishGiftFn = useServerFn(publishGift);
  const checkCostFn = useServerFn(checkGiftCost);

  // Таймер записи для отображения «Запись 0:07».
  useEffect(() => {
    if (voice.status !== "recording") return;
    setRecSeconds(0);
    const id = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [voice.status]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const compressImage = (dataUrl: string, maxSize = 1280, quality = 0.8): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
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

  const MAX_PHOTOS = 10;

  const readFile = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = await compressImage(String(reader.result));
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const slots = Math.max(0, MAX_PHOTOS - photoPreviews.length);
    if (slots === 0) {
      setError(`Можно загрузить максимум ${MAX_PHOTOS} фото`);
      return;
    }
    const toRead = files.slice(0, slots);
    try {
      const urls = await Promise.all(toRead.map(readFile));
      const wasEmpty = photoPreviews.length === 0;
      setPhotoPreviews((prev) => [...prev, ...urls]);
      setError(null);
      // ИИ описывает только первый загруженный кадр (когда галерея была пуста)
      if (wasEmpty && urls[0]) {
        setDescription("");
        setStatus("✨ ИИ рассматривает фото и пишет описание...");
        try {
          const { description: aiDesc, condition: aiCond } = await describeImage({
            data: { imageDataUrl: urls[0] },
          });
          setDescription(aiDesc);
          if (showCondition && typeof aiCond === "number") setCondition(aiCond);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Не удалось описать фото");
        } finally {
          setStatus(null);
        }
      }
    } catch {
      setError("Не удалось загрузить фото");
    }
  };

  const removePhoto = (idx: number) =>
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    const hasPhoto = photoPreviews.length > 0;
    if (!description.trim() && !hasPhoto) {
      setError("Опишите подарок голосом, текстом или прикрепите фото ✨");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus("✨ ИИ придумывает название и категорию...");
      const desc = description.trim() || "Подарок с фотографии";
      // ИИ-название/категория — необязательный шаг. Если он не прошёл (нет
      // сети, ИИ недоступен) — НЕ роняем публикацию: берём название из первых
      // слов описания и категорию «разное».
      let title = "";
      let category = "разное";
      try {
        const meta = await generateMeta({
          data: { description: desc, hasImage: hasPhoto },
        });
        title = meta.title;
        category = meta.category;
      } catch {
        const words = desc.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
        title = (words || "Подарок").slice(0, 80);
        category = "разное";
      }

      // Мягкая подсказка по средней оценке похожих подарков
      try {
        const avgRes = await checkCostFn({
          data: { gift_kind: giftKind, category },
        });
        if (
          avgRes &&
          typeof avgRes.avg === "number" &&
          Math.abs(avgRes.avg - cost) >= 2
        ) {
          toast(`⚖️ Похожие подарки обычно оценивают в ~${avgRes.avg} балл(ов)`, {
            description: `Вы поставили ${cost} — публикуем как есть, модератор посмотрит позже.`,
          });
        }
      } catch {
        /* noop — это не критично для публикации */
      }

      setStatus("📤 Загружаем фото...");
      const uploadedUrls = await uploadImages(photoPreviews);

      setStatus("💾 Сохраняем подарок...");
      const { id } = await publishGiftFn({
        data: {
          title,
          description: description.trim() || null,
          category,
          image_url: uploadedUrls[0] ?? null,
          image_urls: uploadedUrls,
          gift_kind: giftKind,
          cost,
          condition: showCondition ? condition : null,
          quantity: multi ? quantity : 1,
          city: isOnline ? null : city.trim() || null,
          is_online: isOnline,
        },
      });
      if (!isOnline && city.trim() && typeof localStorage !== "undefined") {
        try {
          localStorage.setItem("cozygift_city", city.trim());
        } catch {
          /* noop */
        }
      }
      onDone(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Что-то пошло не так";
      // «Load failed» / fetch — это сорвавшаяся сеть. Подсказываем повторить.
      setError(
        /load failed|fetch|network|timeout|сет/i.test(msg)
          ? "Не получилось — пропала связь. Проверь интернет и нажми «Выложить подарок» ещё раз."
          : msg,
      );
    } finally {
      setLoading(false);
      setStatus(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-5 py-4">
      <button
        onClick={onBack}
        className="mb-4 text-sm text-muted-foreground hover:text-foreground"
      >
        ← Назад
      </button>

      <Card className="border-primary/20 bg-card/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">✨ Расскажите о подарке</CardTitle>
          <CardDescription>
            Опишите подарок — голосом, текстом или фото.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Зона описания целиком: фото, файл, текст и «Дополнить с ИИ» —
              чтобы гид подсвечивал её всю и можно было выбрать любой способ. */}
          <div data-tour="give-describe" className="space-y-4">
          <div className="space-y-2">
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
                <input type="file" accept="image/*" multiple onChange={onPhoto} className="hidden" />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              🤖 ИИ опишет подарок по первой фотографии. Можно добавить до 10 кадров.
            </p>
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
                  Нет фото? Опиши подарок словами — и ИИ нарисует картинку. Подходит для услуг и встреч.
                </p>
              </>
            )}
            {showCondition && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                💛 Будь честным: добавь и фото <b>самой изношенной части</b> (потёртости, царапины) — так получатель доверяет тебе больше, а оценка состояния честнее.
              </p>
            )}
            {photoPreviews.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {photoPreviews.map((src, i) => (
                  <div key={i} className="relative">
                    <img
                      src={src}
                      alt={`Превью ${i + 1}`}
                      className="h-24 w-full rounded-md border object-cover"
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
            {status && photoPreviews.length > 0 && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                <span>{status}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Описание</Label>
            <div className="flex gap-2">
              <Textarea
                id="desc"
                placeholder="Что это, в каком состоянии, кому подойдёт..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onFocus={() => {
                  if (!presetCleared && description === initialDesc && initialDesc) {
                    setDescription("");
                  }
                  setPresetCleared(true);
                }}
                rows={5}
                maxLength={600}
                className="flex-1"
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
            <button
              type="button"
              onClick={enhanceDescription}
              disabled={enhancing || !description.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 py-2 text-sm font-medium text-primary transition active:scale-[0.98] disabled:opacity-50"
            >
              {enhancing ? "✨ ИИ дополняет…" : "✨ Дополнить с ИИ"}
            </button>
            {voice.status === "recording" ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
                </span>
                <span className="font-medium">Запись {formatTime(recSeconds)}</span>
                <span className="ml-auto text-destructive/80">
                  Нажми ⏹, когда закончишь
                </span>
              </div>
            ) : voice.status === "transcribing" ? (
              <p className="text-xs text-muted-foreground">⏳ Распознаём речь…</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Нажмите 🎙️ и продиктуйте описание голосом. Запись остановится по кнопке ⏹ — потом текст подставится сам.
              </p>
            )}
            {voice.error && <p className="text-xs text-amber-600">{voice.error}</p>}
          </div>
          </div>

          {showCondition && (
            <div className="space-y-2" data-tour="give-condition">
              <Label>Состояние (новизна)</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCondition(n)}
                    aria-label={`Оценка состояния ${n} из 5`}
                    className={`text-2xl leading-none transition-transform hover:scale-110 ${
                      condition && n <= condition ? "text-amber-400" : "text-muted-foreground/40"
                    }`}
                  >
                    {condition && n <= condition ? "★" : "☆"}
                  </button>
                ))}
                <span className="ml-2 text-xs text-muted-foreground">
                  {condition ? `${condition} из 5` : "ИИ оценит по фото"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                5 звёзд — как новое, 1 — сильно использованное. ИИ ставит оценку по фото, можно поправить вручную.
              </p>
            </div>
          )}

          {/* Cost / стоимость подарка в баллах */}
          <div className="space-y-2" data-tour="give-cost">
            <Label>Во сколько баллов оцениваешь подарок?</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {COST_TIERS.map((t) => {
                const active = cost === t.cost;
                // Стоимость ограничена уровнем: на 1 уровне доступен только 1 балл,
                // выше — больше. Так дороже дарить можно только «доросшим».
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
              {COST_TIERS.find((t) => t.cost === cost)?.range}
              {userLevel < 5 && " · дороже — с ростом уровня"}
            </p>
          </div>

          {/* Город / онлайн */}
          <div className="space-y-2" data-tour="give-city">
            <Label htmlFor="city">Город</Label>
            <input
              id="city"
              type="text"
              value={isOnline ? "" : city}
              onChange={(e) => setCity(e.target.value)}
              disabled={isOnline}
              placeholder="Например, Сочи"
              maxLength={80}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
              <span className="font-medium">🌐 Онлайн — доступно в любом городе</span>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Для вещей и встреч укажи город. Для онлайн-услуг (консультация, медитация и т.п.) поставь галочку — город не нужен.
            </p>
          </div>

          <div className="space-y-2 rounded-2xl border border-input bg-background p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={multi}
                onChange={(e) => setMulti(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className="font-medium">🔁 Подарить несколько раз</span>
            </label>
            {multi ? (
              <div className="flex items-center gap-2 pl-6">
                <span className="text-sm text-muted-foreground">Сколько раз готов подарить:</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(2, q - 1))}
                  aria-label="Меньше"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border text-base leading-none transition active:scale-95"
                >
                  −
                </button>
                <span className="min-w-[1.5rem] text-center text-sm font-semibold">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  aria-label="Больше"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border text-base leading-none transition active:scale-95"
                >
                  +
                </button>
              </div>
            ) : null}
            <p className="pl-6 text-[11px] text-muted-foreground">
              {multi
                ? "Будет одна карточка с остатком: когда кто-то забронирует — счётчик уменьшится (например, осталось 2 из 3). Удобно для услуг."
                : "Например, услугу или мастер-класс можно подарить нескольким людям. Останется одна карточка с остатком."}
            </p>
          </div>

          {status && (
            <p className="rounded-md bg-accent/40 px-3 py-2 text-sm text-muted-foreground">
              {status}
            </p>
          )}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            data-tour="give-publish"
            onClick={submit}
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? "Готовим..." : "🎁 Выложить подарок"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
