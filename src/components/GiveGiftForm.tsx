import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { generateGiftMeta, describeGiftImage } from "@/lib/gift-ai.functions";

interface Props {
  onDone: (giftId: string) => void;
  onBack: () => void;
  presetHint?: string | null;
}

export function GiveGiftForm({ onDone, onBack, presetHint }: Props) {
  const [description, setDescription] = useState(presetHint ? `${presetHint}. ` : "");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");
  const generateMeta = useServerFn(generateGiftMeta);
  const describeImage = useServerFn(describeGiftImage);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {}
    };
  }, []);

  const toggleMic = () => {
    const SR =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setError("Голосовой ввод не поддерживается в этом браузере");
      return;
    }
    if (recording) {
      try {
        recognitionRef.current?.stop?.();
      } catch {}
      setRecording(false);
      return;
    }
    const rec = new SR();
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = true;
    baseTextRef.current = description ? description.trim() + " " : "";
    rec.onresult = (event: any) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (finalText) baseTextRef.current += finalText + " ";
      setDescription((baseTextRef.current + interim).replace(/\s+/g, " ").trimStart());
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    setRecording(true);
    try {
      rec.start();
    } catch {
      setRecording(false);
    }
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
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
      const { data, error: dbErr } = await supabase
        .from("gifts")
        .insert({
          title,
          description: description.trim() || null,
          category,
          image_url: photoPreview,
          status: "available",
          cost: 50,
        })
        .select("id")
        .single();
      if (dbErr) throw dbErr;
      onDone(data!.id);
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
            Опишите подарок — голосом, текстом или фото. Название и категорию подберёт ИИ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Фото</Label>
            <p className="text-xs text-muted-foreground">
              🤖 ИИ автоматически напишет описание по фотографии
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📁 Выбрать файл
                <input type="file" accept="image/*" onChange={onPhoto} className="hidden" />
              </label>
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
            </div>
            {photoPreview && (
              <img
                src={photoPreview}
                alt="Превью"
                className="mt-2 max-h-48 w-full rounded-md border object-cover"
              />
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
                    ? "animate-pulse border-primary bg-primary text-primary-foreground shadow-md"
                    : "border-input bg-background hover:bg-accent"
                }`}
              >
                🎙️
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {recording
                ? "🎙️ Говорите — текст появится в поле. Нажмите ещё раз, чтобы остановить."
                : "Нажмите 🎙️ и продиктуйте описание голосом."}
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

          <Button onClick={submit} disabled={loading} className="w-full" size="lg">
            {loading ? "Готовим..." : "🎁 Выложить подарок"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
