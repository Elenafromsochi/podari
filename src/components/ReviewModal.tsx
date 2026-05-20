import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const PRESETS = [
  { id: "perfect", label: "Подарок полностью соответствует описанию, большое спасибо! 💚", tone: "positive" },
  { id: "nuances", label: "Подарок отличный, но есть нюансы…", tone: "neutral" },
  { id: "difficulties", label: "Возникли сложности с получением подарка…", tone: "negative" },
  { id: "not_match", label: "Подарок не совсем соответствует описанию", tone: "negative" },
  { id: "warm", label: "Очень тёплое общение с дарителем ✨", tone: "positive" },
] as const;

export function ReviewModal({
  giftId,
  onSubmit,
}: {
  giftId: string;
  onSubmit: (review: { presetId: string; label: string; comment: string }) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const submit = () => {
    if (!selected) return;
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
        className="max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Даритель отметил подарок как переданный 🎁</DialogTitle>
          <DialogDescription>
            Поделитесь впечатлением — это важно для равновесия системы. Окно закроется после отправки отзыва.
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

        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Комментарий (по желанию)"
          className="mt-2"
        />

        <Button onClick={submit} disabled={!selected} className="mt-2 w-full">
          Отправить отзыв
        </Button>
      </DialogContent>
    </Dialog>
  );
}
