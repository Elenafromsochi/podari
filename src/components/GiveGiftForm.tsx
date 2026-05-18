import { useState } from "react";
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

export function GiveGiftForm({ onDone, onBack }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("разное");
  const [autoCategory, setAutoCategory] = useState(true);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveCategory = autoCategory ? guessCategory(`${title} ${description}`) : category;

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
            <Input
              id="title"
              placeholder="Например, «Уютная книга на вечер»"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Игровое описание</Label>
            <Textarea
              id="desc"
              placeholder="Что это, в каком состоянии, кому подойдёт..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={600}
            />
            <p className="text-xs text-muted-foreground">
              Голосовой ввод и ИИ-улучшение — на следующем этапе.
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
            <Label htmlFor="photo">Фото (по желанию)</Label>
            <Input id="photo" type="file" accept="image/*" onChange={onPhoto} />
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
