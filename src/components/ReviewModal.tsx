import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";

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

export function ReviewModal({
  giftId,
  role = "receiver",
  claimedCondition = null,
  onSubmit,
}: {
  giftId: string;
  role?: Role;
  claimedCondition?: number | null;
  onSubmit: (review: {
    presetId: string;
    label: string;
    comment: string;
    rating: number;
    isAuto: boolean;
    conditionConfirmed: number | null;
    proofPhoto: string | null;
  }) => void;
}) {
  const PRESETS = role === "giver" ? PRESETS_GIVER : PRESETS_RECEIVER;
  const showCondition = role === "receiver" && !!claimedCondition;
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [confirmedCondition, setConfirmedCondition] = useState<number | null>(
    claimedCondition,
  );
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);

  // Голос: запись на устройстве + распознавание на сервере — работает в любом
  // браузере. Распознанный текст дописываем к тому, что уже есть в поле.
  const voice = useVoiceRecorder((text) =>
    setComment((prev) => (prev ? prev.trim() + " " : "") + text),
  );
  const [recSeconds, setRecSeconds] = useState(0);

  // Таймер записи для отображения «Запись 0:07» — как в форме подарка.
  useEffect(() => {
    if (voice.status !== "recording") return;
    setRecSeconds(0);
    const id = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [voice.status]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const handleProofPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProofPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  const trimmedComment = comment.trim();
  // Кнопка активна, если выбран готовый ответ ИЛИ написан текст от 20 символов.
  const canSubmit = !!selected || trimmedComment.length >= 20;
  const isAuto = !trimmedComment;
  const xpHint = isAuto ? "+5 XP" : "+20 XP";

  const submit = () => {
    if (!canSubmit) return;
    // Если вариант не выбран — это текстовый отзыв: метки нет, рейтинг по
    // умолчанию положительный (5), сам текст несёт суть.
    const preset = selected ? PRESETS.find((p) => p.id === selected) ?? null : null;
    try {
      localStorage.setItem(
        `cozygift_review_${giftId}_${role}`,
        JSON.stringify({ presetId: preset?.id ?? "custom", label: preset?.label ?? "", comment, ts: Date.now() }),
      );
    } catch { /* noop */ }
    onSubmit({
      presetId: preset?.id ?? "custom",
      label: preset?.label ?? "",
      comment,
      rating: preset?.rating ?? 5,
      isAuto,
      conditionConfirmed: showCondition ? confirmedCondition : null,
      proofPhoto: showCondition ? proofPhoto : null,
    });
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-h-[88dvh] max-w-md gap-2.5 overflow-y-auto p-4 [&>button[aria-label='Close']]:hidden [&>button:last-child]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {role === "giver" ? "Как прошло вручение? ✨" : "Расскажи, как всё прошло! ✨"}
          </DialogTitle>
          <DialogDescription>
            Выбери готовый ответ (+5 XP) или допиши текст / надиктуй голосом (+20 XP).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`rounded-2xl border px-3.5 py-2.5 text-left text-sm leading-snug transition ${
                selected === p.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-accent"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {showCondition && (
          <div className="mt-2 space-y-2 rounded-2xl border border-amber-300/50 bg-amber-50/50 p-3 dark:bg-amber-950/20">
            <div className="text-sm font-medium">Проверь состояние подарка ⭐</div>
            <div className="text-xs text-muted-foreground">
              Даритель оценил на <b>{claimedCondition} из 5</b>. Подтверди честно или
              поправь, как есть на самом деле.
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setConfirmedCondition(n)}
                  aria-label={`Состояние ${n} из 5`}
                  className={`text-2xl leading-none transition-transform hover:scale-110 ${
                    confirmedCondition && n <= confirmedCondition
                      ? "text-amber-400"
                      : "text-muted-foreground/40"
                  }`}
                >
                  {confirmedCondition && n <= confirmedCondition ? "★" : "☆"}
                </button>
              ))}
              <span className="ml-2 text-xs text-muted-foreground">
                {confirmedCondition ? `${confirmedCondition} из 5` : "оцени"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              📸 Фото-подтверждение состояния (по желанию):
            </div>
            <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-xl border bg-background px-3 py-1.5 text-xs font-medium transition active:scale-[0.98] hover:bg-accent">
              📷 {proofPhoto ? "Заменить фото" : "Выбрать фото"}
              <input
                type="file"
                accept="image/*"
                onChange={handleProofPhoto}
                className="hidden"
              />
            </label>
            {proofPhoto && (
              <img
                src={proofPhoto}
                alt="подтверждение"
                className="h-20 w-20 rounded-lg object-cover"
              />
            )}
          </div>
        )}

        <div className="relative mt-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Допиши свой отзыв от 20 символов или надиктуй голосом (+20 XP)"
            rows={3}
            className="pr-12"
          />
          <button
            type="button"
            onClick={voice.toggle}
            disabled={voice.status === "transcribing"}
            aria-label={voice.status === "recording" ? "Остановить запись" : "Голосовой ввод"}
            className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border text-base transition-all ${
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
        ) : null}
        {voice.error && <p className="text-xs text-amber-600">{voice.error}</p>}
        {!selected && trimmedComment.length > 0 && trimmedComment.length < 20 && (
          <p className="text-xs text-muted-foreground">
            Ещё {20 - trimmedComment.length} симв. — и можно отправлять
          </p>
        )}

        <Button onClick={submit} disabled={!canSubmit} className="mt-2 w-full" size="lg">
          Отправить отзыв ({xpHint})
        </Button>
      </DialogContent>
    </Dialog>
  );
}
