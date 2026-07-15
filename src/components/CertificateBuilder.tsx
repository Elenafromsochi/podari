import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, Upload, Share2, Download, Loader2 } from "lucide-react";
import {
  CERT_TEMPLATES,
  renderCertificate,
  type CertTemplateId,
  type CertFields,
} from "@/lib/certificate";
import { uploadImage } from "@/lib/upload-image";
import { makeGiftCertificate } from "@/lib/cozy.functions";
import { shareLink } from "@/lib/share";
import { APP_BASE_URL } from "@/lib/app-url";
import { haptic } from "@/lib/haptics";

function fmtDate(iso: string): string {
  // iso: YYYY-MM-DD → «до 31.12.2026»
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `до ${m[3]}.${m[2]}.${m[1]}` : "";
}

export function CertificateBuilder({
  giftId,
  giftTitle,
  myName,
  onClose,
  onCreated,
}: {
  giftId: string;
  giftTitle: string;
  myName: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [template, setTemplate] = useState<CertTemplateId>("light-bot");
  const [toName, setToName] = useState("");
  const [message, setMessage] = useState("С теплом — этот подарок для тебя");
  const [fromName, setFromName] = useState(myName || "");
  const [hasTerm, setHasTerm] = useState(false);
  const [termDate, setTermDate] = useState("");
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null); // готовая картинка
  const [link, setLink] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const makeFn = useServerFn(makeGiftCertificate);

  const fields: CertFields = useMemo(
    () => ({
      template,
      toName,
      message,
      fromName,
      giftTitle,
      term: hasTerm && termDate ? fmtDate(termDate) : "",
      bgImage,
    }),
    [template, toName, message, fromName, giftTitle, hasTerm, termDate, bgImage],
  );

  // Живое превью — с небольшой задержкой, чтобы не рендерить на каждый символ.
  useEffect(() => {
    if (doneUrl) return;
    let alive = true;
    const t = setTimeout(() => {
      renderCertificate(fields)
        .then((url) => {
          if (alive) setPreview(url);
        })
        .catch(() => {});
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [fields, doneUrl]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const onPickBg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBgImage(String(reader.result));
      setTemplate("custom");
    };
    reader.readAsDataURL(f);
  };

  const create = async () => {
    if (!toName.trim()) {
      toast.error("Впиши, кому сертификат");
      return;
    }
    if (template === "custom" && !bgImage) {
      toast.error("Загрузи фон или выбери другой шаблон");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await renderCertificate(fields);
      const imageUrl = await uploadImage(dataUrl);
      const res = await makeFn({
        data: {
          gift_id: giftId,
          cert_image_url: imageUrl,
          expires_at: hasTerm && termDate ? new Date(termDate + "T23:59:59").toISOString() : null,
        },
      });
      haptic("success");
      setDoneUrl(imageUrl);
      setLink(`${APP_BASE_URL}/gift/${res.id}`);
      onCreated?.();
    } catch (e) {
      toast.error("Не удалось создать сертификат", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-background shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">🎟 Подарочный сертификат</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Превью */}
          <div className="mb-4 overflow-hidden rounded-2xl border bg-muted">
            {preview || doneUrl ? (
              <img src={doneUrl ?? preview ?? ""} alt="Сертификат" className="w-full" />
            ) : (
              <div className="flex h-64 items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
          </div>

          {doneUrl ? (
            <div className="space-y-3">
              <p className="rounded-2xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-center text-sm font-medium text-foreground">
                Сертификат готов 🎉 Отправь его тому, кому даришь — получить сможет только он.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => link && shareLink(`Тебе подарочный сертификат 🎁 «${giftTitle}»`, link)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-mint px-3 py-2.5 text-sm font-semibold text-mint-foreground transition active:scale-95"
                >
                  <Share2 className="h-4 w-4" /> Поделиться
                </button>
                <a
                  href={doneUrl}
                  download="certificate.png"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border bg-background px-3 py-2.5 text-sm font-semibold text-foreground transition active:scale-95 hover:bg-accent"
                >
                  <Download className="h-4 w-4" /> Скачать
                </a>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl border px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-accent"
              >
                Готово
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Шаблоны */}
              <div>
                <div className="mb-1.5 text-sm font-medium">Оформление</div>
                <div className="flex flex-wrap gap-2">
                  {CERT_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        if (t.needsBg && !bgImage) {
                          fileRef.current?.click();
                          return;
                        }
                        setTemplate(t.id);
                      }}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
                        template === t.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {t.needsBg ? "🖼 " : t.dark ? "🌙 " : "☀️ "}
                      {t.label}
                    </button>
                  ))}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onPickBg}
                  className="hidden"
                />
                {template === "custom" && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary"
                  >
                    <Upload className="h-3.5 w-3.5" /> {bgImage ? "Заменить фото" : "Загрузить фото"}
                  </button>
                )}
              </div>

              {/* Поля */}
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Кому</span>
                <input
                  value={toName}
                  onChange={(e) => setToName(e.target.value)}
                  placeholder="Имя получателя"
                  maxLength={40}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Поздравление</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  maxLength={120}
                  className="w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">От кого</span>
                <input
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  maxLength={40}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>

              {/* Срок действия */}
              <div className="rounded-xl border bg-background p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={hasTerm}
                    onChange={(e) => setHasTerm(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Указать срок действия
                </label>
                {hasTerm && (
                  <input
                    type="date"
                    value={termDate}
                    onChange={(e) => setTermDate(e.target.value)}
                    className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                )}
              </div>

              <p className="text-[11px] text-muted-foreground">
                Подарок «{giftTitle}» станет личным — попадёт только тому, кому отправишь ссылку.
              </p>

              <button
                type="button"
                onClick={create}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground shadow-sm transition active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "🎟 Создать сертификат"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
