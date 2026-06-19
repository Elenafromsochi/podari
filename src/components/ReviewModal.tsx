import { useState, useRef } from "react";
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

type SRResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
type SR = {
  start: () => void;
  stop: () => void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
};

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
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<SR | null>(null);
  const wantsRecordingRef = useRef(false);
  const baseTextRef = useRef("");
  const [confirmedCondition, setConfirmedCondition] = useState<number | null>(
    claimedCondition,
  );
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);

  const handleProofPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProofPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  // Голос как в форме подарка: непрерывная запись с авто-перезапуском после
  // пауз, накопление распознанного текста, понятное сообщение, если браузер
  // не поддерживает диктовку (например, в некоторых WebView).
  const createRecognition = (): SR | null => {
    const W = window as unknown as {
      SpeechRecognition?: new () => SR;
      webkitSpeechRecognition?: new () => SR;
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (finalText) baseTextRef.current += finalText + " ";
      setComment((baseTextRef.current + interim).replace(/\s+/g, " ").trimStart());
    };
    r.onerror = (e) => {
      if (e?.error && e.error !== "no-speech" && e.error !== "aborted") {
        setMicError("Не удалось распознать речь. Попробуй ещё раз.");
      }
    };
    r.onend = () => {
      // Пауза в речи завершает сессию — перезапускаем, пока пользователь не нажал «Стоп».
      if (wantsRecordingRef.current) {
        try {
          r.start();
        } catch {
          wantsRecordingRef.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };
    return r;
  };

  const toggleMic = () => {
    setMicError(null);
    if (listening) {
      wantsRecordingRef.current = false;
      try {
        recognitionRef.current?.stop?.();
      } catch { /* noop */ }
      setListening(false);
      baseTextRef.current = comment ? comment.trim() + " " : "";
      return;
    }
    const r = createRecognition();
    if (!r) {
      setMicError("Голосовой ввод не поддерживается в этом браузере — напиши текстом 💚");
      return;
    }
    baseTextRef.current = comment ? comment.trim() + " " : "";
    recognitionRef.current = r;
    wantsRecordingRef.current = true;
    setListening(true);
    try {
      r.start();
    } catch {
      wantsRecordingRef.current = false;
      setListening(false);
      setMicError("Не удалось включить микрофон. Проверь разрешение для сайта.");
    }
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
        className="max-w-md [&>button[aria-label='Close']]:hidden [&>button:last-child]:hidden"
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

        {showCondition && (
          <div className="mt-2 space-y-2 rounded-2xl border border-amber-300/50 bg-amber-50/50 p-3 dark:bg-amber-950/20">
            <div className="text-sm font-medium">Проверь состояние подарка ❤️</div>
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
                  className="text-2xl leading-none transition-transform hover:scale-110"
                >
                  {confirmedCondition && n <= confirmedCondition ? "❤️" : "🤍"}
                </button>
              ))}
              <span className="ml-2 text-xs text-muted-foreground">
                {confirmedCondition ? `${confirmedCondition} из 5` : "оцени"}
              </span>
            </div>
            <label className="block text-xs text-muted-foreground">
              📸 Фото-подтверждение состояния (по желанию):
              <input
                type="file"
                accept="image/*"
                onChange={handleProofPhoto}
                className="mt-1 block w-full text-xs"
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
            onClick={toggleMic}
            aria-label="Голосовой ввод"
            className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border ${
              listening ? "bg-destructive text-destructive-foreground" : "bg-background"
            }`}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        </div>
        {listening && (
          <p className="text-xs text-muted-foreground">
            🎙️ Говори — текст появляется сам. Нажми кнопку ещё раз, чтобы остановить.
          </p>
        )}
        {micError && <p className="text-xs text-amber-600">{micError}</p>}
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
