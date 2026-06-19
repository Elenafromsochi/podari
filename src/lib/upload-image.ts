import { supabase } from "@/integrations/supabase/client";
import { safeUUID } from "@/lib/uuid";

const BUCKET = "gift-images";

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:([^;]+);/.exec(meta)?.[1] ?? "image/jpeg";
  const ext = mime.split("/")[1]?.split("+")[0] ?? "jpg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return { blob: new Blob([arr], { type: mime }), ext };
}

/**
 * Загружает картинку в Supabase Storage и возвращает публичный URL.
 * Если на вход пришёл уже-URL (http/https), просто возвращает его.
 */
export async function uploadImage(dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
  // getSession() читает сессию локально (без сетевого запроса), в отличие от
  // getUser() — поэтому загрузка фото не падает с «Load failed», когда связь
  // с auth-сервисом Supabase на секунду моргнула.
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user?.id;
  if (!uid) throw new Error("Не авторизован");
  const { blob, ext } = dataUrlToBlob(dataUrl);
  const filename = `${uid}/${safeUUID()}.${ext === "jpeg" ? "jpg" : ext}`;

  // Небольшой ретрай на случай обрыва связи при заливке.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
    const { error } = await supabase.storage.from(BUCKET).upload(filename, blob, {
      contentType: blob.type,
      upsert: false,
    });
    if (!error) {
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(filename);
      return pub.publicUrl;
    }
    lastErr = error;
    // Если файл с таким именем вдруг уже есть — это не сеть, повтор не нужен.
    if (/exists|duplicate/i.test(error.message || "")) break;
  }
  throw lastErr instanceof Error ? lastErr : new Error("UPLOAD_FAILED");
}

export async function uploadImages(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(uploadImage));
}
