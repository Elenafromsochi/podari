import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { transcribeAudio } from "@/lib/gift-ai.functions";

type Status = "idle" | "recording" | "transcribing";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

/**
 * Универсальный голосовой ввод: пишем звук через MediaRecorder (есть почти во
 * всех мобильных браузерах) и распознаём на сервере. Работает там, где нет
 * браузерной диктовки (Android, встроенные браузеры мессенджеров и т.д.).
 *
 * onText вызывается с распознанным текстом — обычно его дописывают к полю.
 */
export function useVoiceRecorder(onText: (text: string) => void) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcribeFn = useServerFn(transcribeAudio);

  const start = async () => {
    setError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Запись голоса не поддерживается в этом браузере — напиши текстом 💚");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Нет доступа к микрофону. Разреши доступ для сайта и попробуй снова.");
      return;
    }
    try {
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 1200) {
          setStatus("idle");
          return;
        }
        setStatus("transcribing");
        try {
          const dataUrl = await blobToBase64(blob);
          const res = await transcribeFn({
            data: { audioBase64: dataUrl, mimeType: blob.type },
          });
          if (res.text) onText(res.text);
          else setError("Не удалось разобрать речь — попробуй ещё раз чуть громче.");
        } catch {
          setError("Не получилось распознать. Попробуй ещё раз или напиши текстом.");
        } finally {
          setStatus("idle");
        }
      };
      recRef.current = mr;
      mr.start();
      setStatus("recording");
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("Не удалось начать запись. Попробуй ещё раз.");
      setStatus("idle");
    }
  };

  const stop = () => {
    if (recRef.current && status === "recording") {
      try {
        recRef.current.stop();
      } catch {
        setStatus("idle");
      }
    }
  };

  const toggle = () => {
    if (status === "recording") stop();
    else if (status === "idle") void start();
  };

  return { status, error, toggle, start, stop, setError };
}
