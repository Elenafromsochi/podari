import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { updateGift } from "@/lib/cozy.functions";
import { generateGiftImage } from "@/lib/gift-ai.functions";
import { uploadImages } from "@/lib/upload-image";
import { COST_TIERS, GIFT_KINDS, hasCondition, type GiftKind } from "@/lib/gift-kinds";

export type EditGift = {
  id: string;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  cost?: number | null;
  condition?: number | null;
  gift_kind?: string | null;
  city?: string | null;
  is_online?: boolean | null;
  quantity?: number | null;
};

interface Props {
  gift: EditGift;
  userLevel: number;
  onDone: () => void;
  onBack: () => void;
}

const MAX_PHOTOS = 10;

export function GiftEditForm({ gift, userLevel, onDone, onBack }: Props) {
  const [title, setTitle] = useState(gift.title ?? "");
  const [category, setCategory] = useState(gift.category ?? "");
  const [description, setDescription] = useState(gift.description ?? "");
  const [giftKind, setGiftKind] = useState<GiftKind>(
    (gift.gift_kind as GiftKind) || "used_item",
  );
  const [cost, setCost] = useState<number>(gift.cost ?? 1);
  const [condition, setCondition] = useState<number | null>(gift.condition ?? null);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>(
    (gift.image_urls && gift.image_urls.length > 0
      ? gift.image_urls
      : gift.image_url
        ? [gift.image_url]
        : []
    ).filter(Boolean) as string[],
  );
  const [city, setCity] = useState<string>(gift.city ?? "");
  const [isOnline, setIsOnline] = useState<boolean>(!!gift.is_online);
  const [multi, setMulti] = useState<boolean>((gift.quantity ?? 1) > 1);
  const [quantity, setQuantity] = useState<number>(
    (gift.quantity ?? 1) > 1 ? (gift.quantity as number) : 3,
  );

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [genImg, setGenImg] = useState(false);

  const showCondition = hasCondition(giftKind);
  const updateFn = useServerFn(updateGift);
  const genImageFn = useServerFn(generateGiftImage);

  const handleGenImage = async () => {
    if (!description.trim() && !title.trim()) return;
    setGenImg(true);
    setError(null);
    try {
      const { imageDataUrl } = await genImageFn({
        data: { description: description.trim(), title: title.trim() },
      });
      setPhotoPreviews((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, imageDataUrl]));
      toast.success("Картинка готова 🎨", { description: "Можно оставить или удалить" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не получилось нарисовать";
      setError(msg);
    } finally {
      setGenImg(false);
    }
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const room = MAX_PHOTOS - photoPreviews.length;
    files.slice(0, room).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setPhotoPreviews((prev) =>
          prev.length >= MAX_PHOTOS ? prev : [...prev, reader.result as string],
        );
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const removePhoto = (i: number) =>
    setPhotoPreviews((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Заполни название");
      return;
    }
    if (!category.trim()) {
      setError("Заполни категорию");
      return;
    }
    setLoading(true);
    try {
      setStatus("📤 Загружаем фото...");
      const uploadedUrls = await uploadImages(photoPreviews);

      setStatus("💾 Сохраняем изменения...");
      await updateFn({
        data: {
          id: gift.id,
          title: title.trim(),
          description: description.trim() || null,
          category: category.trim(),
          cost,
          gift_kind: giftKind,
          condition: showCondition ? condition : null,
          image_url: uploadedUrls[0] ?? null,
          image_urls: uploadedUrls,
          city: isOnline ? null : city.trim() || null,
          is_online: isOnline,
          quantity: multi ? quantity : 1,
        },
      });
      toast.success("Подарок обновлён ✨");
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Что-то пошло не так";
      if (msg.includes("GIFT_IN_DEAL"))
        setError("Нельзя изменить: подарок уже в сделке");
      else if (msg.includes("LEVEL_TOO_LOW"))
        setError("Эта стоимость откроется на более высоком уровне");
      else if (msg.includes("NOT_OWNER"))
        setError("Это не твой подарок");
      else
        setError(
          /load failed|fetch|network|timeout|сет/i.test(msg)
            ? "Пропала связь. Проверь интернет и сохрани ещё раз."
            : msg,
        );
    } finally {
      setLoading(false);
      setStatus(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← Назад
      </button>

      <Card className="border-primary/20 bg-card/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">✏️ Редактировать подарок</CardTitle>
          <CardDescription>Изменения сразу увидят все</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Фото */}
          <div className="space-y-2">
            <Label>Фотографии</Label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📷 Сделать фото
                <input type="file" accept="image/*" capture="environment" multiple onChange={onPhoto} className="hidden" />
              </label>
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                📁 Выбрать файлы
                <input type="file" accept="image/*" multiple onChange={onPhoto} className="hidden" />
              </label>
            </div>
            {photoPreviews.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {photoPreviews.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt={`Фото ${i + 1}`} className="h-24 w-full rounded-md border object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/95 text-xs shadow ring-1 ring-border hover:bg-destructive hover:text-destructive-foreground"
                      aria-label="Удалить фото"
                    >
                      ✕
                    </button>
                    {i === 0 && (
                      <span className="absolute bottom-1 left-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                        обложка
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {photoPreviews.length === 0 && (
              <button
                type="button"
                onClick={handleGenImage}
                disabled={genImg || (!description.trim() && !title.trim())}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 py-2.5 text-sm font-medium text-primary transition active:scale-[0.98] disabled:opacity-50"
              >
                {genImg ? "🎨 ИИ рисует…" : "🎨 Нарисовать картинку по описанию"}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <Label>Тип подарка</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {GIFT_KINDS.map((k) => {
                const active = giftKind === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setGiftKind(k.id as GiftKind)}
                    className={`flex items-center gap-1.5 rounded-xl border-2 px-2 py-2 text-xs font-medium transition ${
                      active
                        ? "border-emerald-500 bg-emerald-100 text-emerald-800"
                        : "border-input bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span>{k.emoji}</span>
                    <span className="truncate">{k.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Название */}
          <div className="space-y-1.5">
            <Label htmlFor="e-title">Название</Label>
            <Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Например, наушники Sony" />
          </div>

          {/* Категория */}
          <div className="space-y-1.5">
            <Label htmlFor="e-cat">Категория</Label>
            <Input id="e-cat" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} placeholder="Например, электроника" />
          </div>

          {/* Описание */}
          <div className="space-y-1.5">
            <Label htmlFor="e-desc">Описание</Label>
            <Textarea
              id="e-desc"
              rows={5}
              maxLength={600}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что это, в каком состоянии, кому подойдёт..."
            />
          </div>

          {/* Состояние */}
          {showCondition && (
            <div className="space-y-2">
              <Label>Состояние (новизна)</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCondition(n)}
                    aria-label={`Оценка состояния ${n} из 5`}
                    className={`text-2xl leading-none transition-transform hover:scale-110 ${
                      condition && n <= condition ? "text-amber-400" : "text-muted-foreground/40"
                    }`}
                  >
                    {condition && n <= condition ? "★" : "☆"}
                  </button>
                ))}
                <span className="ml-2 text-xs text-muted-foreground">
                  {condition ? `${condition} из 5` : "не указано"}
                </span>
              </div>
            </div>
          )}

          {/* Стоимость */}
          <div className="space-y-2">
            <Label>Во сколько баллов оцениваешь подарок?</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {COST_TIERS.map((t) => {
                const active = cost === t.cost;
                const locked = t.cost > userLevel;
                return (
                  <button
                    key={t.cost}
                    type="button"
                    onClick={() => {
                      if (locked) {
                        toast(`🔒 ${t.cost} ${t.cost < 5 ? "балла" : "баллов"}`, {
                          description: `Откроется на ${t.cost} уровне.`,
                        });
                        return;
                      }
                      setCost(t.cost);
                    }}
                    aria-disabled={locked}
                    className={`flex flex-col items-center rounded-xl border-2 px-1 py-2 text-[11px] font-medium transition ${
                      locked
                        ? "cursor-not-allowed border-input bg-muted/40 text-muted-foreground/50"
                        : active
                          ? "border-emerald-500 bg-emerald-100 text-emerald-800 shadow-sm"
                          : "border-input bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span className="text-sm font-semibold">{locked ? "🔒" : t.cost}</span>
                    <span className="text-[9px] opacity-70">
                      {locked ? `ур. ${t.cost}` : t.cost === 1 ? "балл" : t.cost < 5 ? "балла" : "баллов"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Город / онлайн */}
          <div className="space-y-2">
            <Label htmlFor="e-city">Город</Label>
            <input
              id="e-city"
              type="text"
              value={isOnline ? "" : city}
              onChange={(e) => setCity(e.target.value)}
              disabled={isOnline}
              placeholder="Например, Сочи"
              maxLength={80}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            />
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={isOnline}
                onChange={(e) => setIsOnline(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className="font-medium">🌐 Онлайн — доступно в любом городе</span>
            </label>
          </div>

          {/* Многоразовый */}
          <div className="space-y-2 rounded-2xl border border-input bg-background p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={multi}
                onChange={(e) => setMulti(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className="font-medium">🔁 Подарить несколько раз</span>
            </label>
            {multi ? (
              <div className="flex items-center gap-2 pl-6">
                <span className="text-sm text-muted-foreground">Сколько раз:</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(2, q - 1))}
                  aria-label="Меньше"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border text-base leading-none transition active:scale-95"
                >
                  −
                </button>
                <span className="min-w-[1.5rem] text-center text-sm font-semibold">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  aria-label="Больше"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border text-base leading-none transition active:scale-95"
                >
                  +
                </button>
              </div>
            ) : null}
          </div>

          {status && (
            <p className="rounded-md bg-accent/40 px-3 py-2 text-sm text-muted-foreground">{status}</p>
          )}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <Button onClick={handleSave} disabled={loading} className="w-full bg-emerald-600 text-white hover:bg-emerald-700">
            {loading ? "Сохраняем…" : "💾 Сохранить изменения"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
