import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff } from "lucide-react";

type Role = "receiver" | "giver";

const PRESETS_RECEIVER = [
  { id: "success", label: "Всё прошло успешно, подарок полностью соответствует описанию! 🔥", rating: 5 },
  { id: "nuances", label: "Подарок классный, но есть нюансы… 💬", rating: 4 },
  { id: "failed",  label: "Сделка отменилась / что-то пошло не так 😕", rating: 2 },
] as const;

const PRESETS_GIVER = [
  { id: "success", label: "Всё прошло отлично, получатель добродушный и благодарный 🌿", rating: 5 },
  { id: "nuances", label: "Хорошо, но есть нюансы… 💬", rating: 4 },
  { id: "failed",  label: "Что-то пошло не так 😕", rating: 2 },
] as const;

type SR = {
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
};

export function ReviewModal({
  giftId,
  role = "receiver",
  onSubmit,
}: {
  giftId: string;
  role?: Role;
  onSubmit: (review: { presetId: string; label: string; comment: string; rating: number; isAuto: boolean }) => void;
}) {
  const PRESETS = role === "giver" ? PRESETS_GIVER : PRESETS_RECEIVER;
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [listening, setListening] = useState(false);

  const toggleMic = () => {
    const W = window as unknown as {
      SpeechRecognition?: new () => SR;
      webkitSpeechRecognition?: new () => SR;
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) { setListening(false); return; }
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setComment(t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    setListening(true);
  };

  const canSubmit = !!selected;
  const isAuto = !comment.trim();
  const xpHint = isAuto ? "+5 Опыта" : "+20 Опыта";

  const submit = () => {
    if (!selected) return;
    const preset = PRESETS.find((p) => p.id === selected)!;
    try {
      localStorage.setItem(
        `cozygift_review_${giftId}_${role}`,
        JSON.stringify({ presetId: preset.id, label: preset.label, comment, ts: Date.now() }),
      );
    } catch { /* noop */ }
    onSubmit({
      presetId: preset.id,
      label: preset.label,
      comment,
      rating: preset.rating,
      isAuto,
    });
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md [&>button[aria-label='Close']]:hidden [&>button:last-child]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {role === "giver" ? "Как прошло вручение? ✨" : "Расскажи, как всё прошло! ✨"}
          </DialogTitle>
          <DialogDescription>
            Выбери готовый ответ (+5 Опыта) или допиши текст / надиктуй голосом (+20 Опыта).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                selected === p.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-accent"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="relative mt-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Хочешь — допиши свой отзыв (+20 Опыта)"
            rows={3}
            className="pr-12"
          />
          <button
            onClick={toggleMic}
            aria-label="Голосовой ввод"
            className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border ${
              listening ? "bg-destructive text-destructive-foreground" : "bg-background"
            }`}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        </div>

        <Button onClick={submit} disabled={!canSubmit} className="mt-2 w-full" size="lg">
          Отправить отзыв ({xpHint})
        </Button>
      </DialogContent>
    </Dialog>
  );
}
