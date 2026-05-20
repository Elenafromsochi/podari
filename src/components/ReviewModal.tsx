import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff } from "lucide-react";

const PRESETS = [
  {
    id: "success",
    label: "Всё прошло успешно, подарок полностью соответствует описанию! 🔥",
  },
  {
    id: "nuances",
    label: "Подарок классный, но есть нюансы… 💬",
  },
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
  onSubmit,
}: {
  giftId: string;
  onSubmit: (review: { presetId: string; label: string; comment: string }) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [listening, setListening] = useState(false);

  const toggleMic = (target: "main" | "nuances") => {
    const W = window as unknown as {
      SpeechRecognition?: new () => SR;
      webkitSpeechRecognition?: new () => SR;
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      setListening(false);
      return;
    }
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setComment(t);
      if (target === "nuances" && !selected) setSelected("nuances");
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    setListening(true);
  };

  const nuancesSelected = selected === "nuances";
  const canSubmit = selected && (!nuancesSelected || comment.trim().length > 0);

  const submit = () => {
    if (!selected || !canSubmit) return;
    const preset = PRESETS.find((p) => p.id === selected)!;
    try {
      localStorage.setItem(
        `cozygift_review_${giftId}`,
        JSON.stringify({ presetId: preset.id, label: preset.label, comment, ts: Date.now() }),
      );
    } catch {
      /* noop */
    }
    onSubmit({ presetId: preset.id, label: preset.label, comment });
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md [&>button[aria-label='Close']]:hidden [&>button:last-child]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Расскажи, как всё прошло! ✨</DialogTitle>
          <DialogDescription>
            Это важно для равновесия системы. Окно закроется после отправки отзыва — за него вы получите +40 XP.
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

        {nuancesSelected && (
          <div className="mt-2 animate-fade-in space-y-2">
            <label className="text-sm font-medium">Расскажи подробнее, что за нюансы?</label>
            <div className="relative">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Поделись деталями, что можно улучшить…"
                rows={4}
                className="pr-12"
              />
              <button
                onClick={() => toggleMic("nuances")}
                aria-label="Голосовой ввод"
                className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border ${
                  listening ? "bg-destructive text-destructive-foreground" : "bg-background"
                }`}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {!nuancesSelected && (
          <div className="relative mt-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Комментарий (по желанию)"
              className="pr-12"
            />
            <button
              onClick={() => toggleMic("main")}
              aria-label="Голосовой ввод"
              className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border ${
                listening ? "bg-destructive text-destructive-foreground" : "bg-background"
              }`}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          </div>
        )}

        <Button onClick={submit} disabled={!canSubmit} className="mt-2 w-full" size="lg">
          Отправить отзыв (+40 XP)
        </Button>
      </DialogContent>
    </Dialog>
  );
}
