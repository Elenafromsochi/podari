import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { publishGift } from "@/lib/cozy.functions";
import { generateGiftMeta, describeGiftImage } from "@/lib/gift-ai.functions";

import type { GiftKind } from "@/lib/gift-kinds";

interface Props {
  onDone: (giftId: string) => void;
  onBack: () => void;
  presetHint?: string | null;
  giftKind: GiftKind;
}

export function GiveGiftForm({ onDone, onBack, presetHint, giftKind }: Props) {
  const [description, setDescription] = useState(presetHint ? `${presetHint}. ` : "");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
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
  const publishGiftFn = useServerFn(publishGift);

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
      // 'no-speech' и 'aborted' — это нормальные обрывы, не показываем ошибку
      if (e?.error && e.error !== "no-speech" && e.error !== "aborted") {
        setError("Ошибка распознавания. Попробуйте ещё раз.");
      }
    };
    rec.onend = () => {
      // Авто-перезапуск, пока пользователь не нажал «Стоп»
      if (wantsRecordingRef.current) {
        try {
          rec.start();
        } catch {
          // если не получилось — окончательно останавливаем
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
      // Закрепляем интерим в основном тексте
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

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const rawUrl = String(reader.result);
      const dataUrl = await compressImage(rawUrl);
      setPhotoPreview(dataUrl);
      setError(null);
      setDescription("");
      setStatus("✨ ИИ рассматривает фото и пишет описание...");
      try {
        const { description: aiDesc } = await describeImage({ data: { imageDataUrl: dataUrl } });
        setDescription(aiDesc);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось описать фото");
      } finally {
        setStatus(null);
      }
    };
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!description.trim() && !photoPreview) {
      setError("Опишите подарок голосом, текстом или прикрепите фото ✨");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus("✨ ИИ придумывает название и категорию...");
      const desc = description.trim() || "Подарок с фотографии";
      const { title, category } = await generateMeta({
        data: { description: desc, hasImage: !!photoPreview },
      });

      setStatus("💾 Сохраняем подарок...");
      const { id } = await publishGiftFn({
        data: {
          title,
          description: description.trim() || null,
          category,
          image_url: photoPreview,
          gift_kind: giftKind,
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
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📷 Сделать фото
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPhoto}
                  className="hidden"
                />
              </label>
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📁 Выбрать файл
                <input type="file" accept="image/*" onChange={onPhoto} className="hidden" />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              🤖 ИИ автоматически напишет описание по фотографии
            </p>
            {photoPreview && (
              <img
                src={photoPreview}
                alt="Превью"
                className="mt-2 max-h-48 w-full rounded-md border object-cover"
              />
            )}
            {status && photoPreview && (
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

          <Button onClick={submit} disabled={loading} className="w-full" size="lg">
            {loading ? "Готовим..." : "🎁 Выложить подарок"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
