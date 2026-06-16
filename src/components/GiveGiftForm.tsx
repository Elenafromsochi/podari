import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { publishGift, checkGiftCost } from "@/lib/cozy.functions";
import { generateGiftMeta, describeGiftImage, enhanceGiftDescription } from "@/lib/gift-ai.functions";
import { uploadImages } from "@/lib/upload-image";

import { COST_TIERS, hasCondition, type GiftKind } from "@/lib/gift-kinds";

interface Props {
  onDone: (giftId: string) => void;
  onBack: () => void;
  presetHint?: string | null;
  giftKind: GiftKind;
}

export function GiveGiftForm({ onDone, onBack, presetHint, giftKind }: Props) {
  // Сердечки/износ показываем только для вещей; у услуг и встреч их нет.
  const showCondition = hasCondition(giftKind);
  const [description, setDescription] = useState(presetHint ? `${presetHint}. ` : "");
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [cost, setCost] = useState<number>(1);
  const [condition, setCondition] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [recSeconds, setRecSeconds] = useState(0);

  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");
  const wantsRecordingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generateMeta = useServerFn(generateGiftMeta);
  const describeImage = useServerFn(describeGiftImage);
  const enhanceFn = useServerFn(enhanceGiftDescription);
  const [enhancing, setEnhancing] = useState(false);

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

  useEffect(() => {
    return () => {
      wantsRecordingRef.current = false;
      try {
        recognitionRef.current?.stop?.();
      } catch {}
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    setRecSeconds(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const createRecognition = () => {
    const SR =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event: any) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (finalText) baseTextRef.current += finalText + " ";
      setInterimText(interim);
      setDescription((baseTextRef.current + interim).replace(/\s+/g, " ").trimStart());
    };
    rec.onerror = (e: any) => {
      if (e?.error && e.error !== "no-speech" && e.error !== "aborted") {
        setError("Ошибка распознавания. Попробуйте ещё раз.");
      }
    };
    rec.onend = () => {
      if (wantsRecordingRef.current) {
        try {
          rec.start();
        } catch {
          wantsRecordingRef.current = false;
          setRecording(false);
          setInterimText("");
          stopTimer();
        }
      } else {
        setRecording(false);
        setInterimText("");
        stopTimer();
      }
    };
    return rec;
  };

  const toggleMic = () => {
    if (recording) {
      wantsRecordingRef.current = false;
      try {
        recognitionRef.current?.stop?.();
      } catch {}
      setRecording(false);
      setInterimText("");
      stopTimer();
      baseTextRef.current = description ? description.trim() + " " : "";
      return;
    }
    const rec = createRecognition();
    if (!rec) {
      setError("Голосовой ввод не поддерживается в этом браузере");
      return;
    }
    baseTextRef.current = description ? description.trim() + " " : "";
    recognitionRef.current = rec;
    wantsRecordingRef.current = true;
    setError(null);
    setRecording(true);
    startTimer();
    try {
      rec.start();
    } catch {
      wantsRecordingRef.current = false;
      setRecording(false);
      stopTimer();
    }
  };

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
      const { title, category } = await generateMeta({
        data: { description: desc, hasImage: hasPhoto },
      });

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
        },
      });
      onDone(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Что-то пошло не так");
    } finally {
      setLoading(false);
      setStatus(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
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
        <CardContent className="space-y-5">
          <div className="space-y-2" data-tour="give-photo">
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
                rows={5}
                maxLength={600}
                className="flex-1"
              />
              <button
                type="button"
                onClick={toggleMic}
                aria-label={recording ? "Остановить запись" : "Голосовой ввод"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-lg transition-all ${
                  recording
                    ? "animate-pulse border-destructive bg-destructive text-destructive-foreground shadow-md"
                    : "border-input bg-background hover:bg-accent"
                }`}
              >
                {recording ? "⏹" : "🎙️"}
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
            {recording ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
                </span>
                <span className="font-medium">Запись {formatTime(recSeconds)}</span>
                <span className="truncate text-destructive/80">
                  {interimText ? `«${interimText}»` : "слушаю..."}
                </span>
                <button
                  type="button"
                  onClick={toggleMic}
                  className="ml-auto rounded border border-destructive/40 bg-background px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                >
                  Стоп
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Нажмите 🎙️ и продиктуйте описание голосом. Можно делать паузы — запись не прервётся, пока не нажмёте «Стоп».
              </p>
            )}
          </div>

          {showCondition && (
            <div className="space-y-2">
              <Label>Состояние (новизна)</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCondition(n)}
                    aria-label={`Оценка состояния ${n} из 5`}
                    className="text-2xl leading-none transition-transform hover:scale-110"
                  >
                    {condition && n <= condition ? "❤️" : "🤍"}
                  </button>
                ))}
                <span className="ml-2 text-xs text-muted-foreground">
                  {condition ? `${condition} из 5` : "ИИ оценит по фото"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                5 сердечек — как новое, 1 — сильно использованное. ИИ ставит оценку по фото, можно поправить вручную.
              </p>
            </div>
          )}

          {/* Cost / стоимость подарка в баллах */}
          <div className="space-y-2" data-tour="give-cost">
            <Label>Во сколько баллов оцениваешь подарок?</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {COST_TIERS.map((t) => {
                const active = cost === t.cost;
                return (
                  <button
                    key={t.cost}
                    type="button"
                    onClick={() => setCost(t.cost)}
                    className={`flex flex-col items-center rounded-xl border px-1 py-2 text-[11px] font-medium transition ${
                      active
                        ? "border-primary bg-primary/10 text-foreground shadow-sm"
                        : "border-input bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span className="text-sm font-semibold">{t.cost}</span>
                    <span className="text-[9px] opacity-70">
                      {t.cost === 1 ? "балл" : t.cost < 5 ? "балла" : "баллов"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {COST_TIERS.find((t) => t.cost === cost)?.range}
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
