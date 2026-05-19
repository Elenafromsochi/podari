import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

const CATEGORIES = ["книги", "медитации", "кофе", "музыка", "еда", "разное"];

interface Props {
  onDone: (giftId: string) => void;
  onBack: () => void;
}

function guessCategory(text: string): string {
  const t = text.toLowerCase();
  if (/книг|чита|роман|стих/.test(t)) return "книги";
  if (/медит|йог|дыхан|релакс/.test(t)) return "медитации";
  if (/коф|латте|капучин|эспрессо/.test(t)) return "кофе";
  if (/гитар|музык|пианин|песн/.test(t)) return "музыка";
  if (/торт|выпеч|пирог|еда|пиц/.test(t)) return "еда";
  return "разное";
}

const TITLE_SAMPLES = [
  "Уютная книга на вечер",
  "Свежемолотый кофе для друга",
  "Гид по медитациям для начинающих",
];
const DESC_SAMPLES = [
  "Почти новая, читал пару раз. Мягкая обложка, приятно держать в руках. Отдам тому, кто любит вдумчивые истории.",
  "Зерно средней обжарки, открыл вчера. Хватит на пару недель утренних чашек. Заберите, если рядом с центром.",
  "Подборка коротких практик на 10 минут. Помогает выдохнуть после рабочего дня. Поделюсь PDF и парой советов.",
];

export function GiveGiftForm({ onDone, onBack }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("разное");
  const [autoCategory, setAutoCategory] = useState(true);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<null | "title" | "description">(null);

  const effectiveCategory = autoCategory ? guessCategory(`${title} ${description}`) : category;

  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {}
    };
  }, []);

  const simulateMic = (target: "title" | "description") => {
    if (recording) return;
    setRecording(target);
    const pool = target === "title" ? TITLE_SAMPLES : DESC_SAMPLES;
    const phrase = pool[Math.floor(Math.random() * pool.length)];
    const setter = target === "title" ? setTitle : setDescription;
    setter("");
    let i = 0;
    const interval = setInterval(() => {
      i += 2;
      setter(phrase.slice(0, Math.min(i, phrase.length)));
      if (i >= phrase.length) {
        clearInterval(interval);
        setRecording(null);
      }
    }, 35);
  };

  const startRealMic = () => {
    const SR =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      // Fallback to simulation if API unavailable
      simulateMic("description");
      return;
    }
    if (recording === "description") {
      try {
        recognitionRef.current?.stop?.();
      } catch {}
      setRecording(null);
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
      if (finalText) {
        baseTextRef.current += finalText + " ";
      }
      setDescription((baseTextRef.current + interim).replace(/\s+/g, " ").trimStart());
    };
    rec.onerror = () => {
      setRecording(null);
    };
    rec.onend = () => {
      setRecording((r) => (r === "description" ? null : r));
    };
    recognitionRef.current = rec;
    setRecording("description");
    try {
      rec.start();
    } catch {
      setRecording(null);
    }
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(String(reader.result));
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!title.trim()) {
      setError("Дайте подарку имя ✨");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from("gifts")
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          category: effectiveCategory,
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
            Шаг 2 · Путь дарителя. Опишите вещь так, чтобы хотелось забрать.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Название</Label>
            <div className="flex gap-2">
              <Input
                id="title"
                placeholder="Например, «Уютная книга на вечер»"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
              />
              <MicButton
                active={recording === "title"}
                disabled={recording !== null && recording !== "title"}
                onClick={() => simulateMic("title")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Описание</Label>
            <div className="flex gap-2">
              <Textarea
                id="desc"
                placeholder="Что это, в каком состоянии, кому подойдёт..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={600}
                className="flex-1"
              />
              <MicButton
                active={recording === "description"}
                disabled={recording !== null && recording !== "description"}
                onClick={startRealMic}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {recording === "description"
                ? "🎙️ Говорите — текст появится в поле. Нажмите ещё раз, чтобы остановить."
                : "Нажмите 🎙️ и продиктуйте описание голосом."}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Категория</Label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoCategory}
                  onChange={(e) => setAutoCategory(e.target.checked)}
                  className="accent-primary"
                />
                подобрать автоматически
              </label>
            </div>
            {autoCategory ? (
              <div className="rounded-md border border-dashed border-primary/30 bg-accent/40 px-3 py-2 text-sm">
                Угадано: <span className="font-medium">{effectiveCategory}</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      category === c
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Фото (по желанию)</Label>
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

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            onClick={submit}
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? "Сохраняем..." : "🎁 Опубликовать подарок"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function MicButton({
  active,
  disabled,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={active ? "Идёт запись" : "Голосовой ввод"}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-lg transition-all ${
        active
          ? "animate-pulse border-primary bg-primary text-primary-foreground shadow-md"
          : "border-input bg-background hover:bg-accent disabled:opacity-40"
      }`}
    >
      🎙️
    </button>
  );
}
