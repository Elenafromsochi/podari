import { supabase } from "@/integrations/supabase/client";

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
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error("Не авторизован");
  const { blob, ext } = dataUrlToBlob(dataUrl);
  const filename = `${uid}/${crypto.randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(filename, blob, {
    contentType: blob.type,
    upsert: false,
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return pub.publicUrl;
}

export async function uploadImages(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(uploadImage));
}
