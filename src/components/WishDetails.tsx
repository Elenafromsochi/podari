import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fulfillWish, deleteWish, setWishHidden } from "@/lib/wishes.functions";
import { haptic } from "@/lib/haptics";
import { Share2 } from "lucide-react";
import { shareWish } from "@/lib/share";
import { CityBadge } from "@/components/CityBadge";

type Wish = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  image_urls: string[] | null;
  status: string;
  cost: number;
  owner_id: string;
  created_at: string;
  city?: string | null;
  is_online?: boolean | null;
  link?: string | null;
};

interface Props {
  wishId: string;
  onBack: () => void;
  onFulfilled: (txId: string, chatId: string, wishId: string) => void;
  onDeleted: () => void;
}

export function WishDetails({ wishId, onBack, onFulfilled, onDeleted }: Props) {
  const [wish, setWish] = useState<Wish | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string>("Гость");
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fulfillFn = useServerFn(fulfillWish);
  const deleteFn = useServerFn(deleteWish);
  const setHiddenFn = useServerFn(setWishHidden);

  const toggleHidden = async () => {
    if (!wish) return;
    const hide = wish.status !== "hidden";
    try {
      const res = await setHiddenFn({ data: { wish_id: wishId, hidden: hide } });
      setWish((p) => (p ? { ...p, status: res.status } : p));
      haptic("success");
      toast.success(hide ? "Скрыто — во Вселенной 🌌" : "Открыто для всех ✨");
    } catch {
      toast.error("Не получилось изменить видимость");
    }
  };

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setMeId(u.user?.id ?? null);
      // Пробуем самый полный набор; если каких-то колонок нет (миграция не
      // накатана) — откатываемся к более узким.
      const colSets = [
        "id,title,description,category,image_url,image_urls,status,owner_id,created_at,cost,city,is_online,link",
        "id,title,description,category,image_url,image_urls,status,owner_id,created_at,cost,city,is_online",
        "id,title,description,category,image_url,image_urls,status,owner_id,created_at,cost",
        "id,title,description,category,image_url,image_urls,status,owner_id,created_at",
      ];
      let data: Record<string, unknown> | null = null;
      for (const cols of colSets) {
        const res = await supabase.from("wishes").select(cols).eq("id", wishId).maybeSingle();
        if (!res.error) {
          data = res.data as Record<string, unknown> | null;
          break;
        }
      }
      setWish(
        data ? ({ ...data, cost: Number((data as { cost?: number }).cost) || 1 } as Wish) : null,
      );
      if (data?.owner_id) {
        const { data: profs } = await supabase.rpc("get_public_profiles", {
          _user_ids: [data.owner_id],
        });
        const list = (profs ?? []) as Array<{ display_name: string }>;
        setOwnerName(list[0]?.display_name || "Гость");
      }
    })();
  }, [wishId]);

  const isOwn = !!(meId && wish && wish.owner_id === meId);
  const isOpen = wish?.status === "open";

  const handleFulfill = async () => {
    setLoading(true);
    try {
      const res = await fulfillFn({ data: { wish_id: wishId } });
      haptic("success");
      toast.success("Чат с пожелателем открыт 💚");
      onFulfilled(res.transaction_id, res.chat_id, wishId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ALREADY_TAKEN")) toast.error("Это пожелание уже исполняют");
      else if (msg.includes("OWN_WISH")) toast.error("Это твоё пожелание 🙂");
      else toast.error("Не получилось", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteFn({ data: { wish_id: wishId } });
      setConfirmDelete(false);
      toast.success("Пожелание удалено");
      onDeleted();
    } catch (e) {
      toast.error("Не удалось удалить", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  if (!wish) {
    return (
      <div className="mx-auto w-full max-w-md px-5 py-8">
        <button onClick={onBack} className="mb-4 text-sm text-muted-foreground">
          ← Назад
        </button>
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6">
      <button onClick={onBack} className="mb-4 text-sm text-muted-foreground hover:text-foreground">
        ← Назад
      </button>

      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        {wish.image_url ? (
          <img src={wish.image_url} alt={wish.title} className="h-56 w-full object-cover" />
        ) : (
          <div className="flex h-40 w-full items-center justify-center bg-peach/40 text-6xl">
            ✨
          </div>
        )}
        {wish.image_urls && wish.image_urls.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-b bg-background/60 px-3 py-2">
            {wish.image_urls.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="shrink-0">
                <img
                  src={src}
                  alt={`Фото ${i + 1}`}
                  className="h-16 w-16 rounded-lg object-cover ring-1 ring-border"
                />
              </a>
            ))}
          </div>
        )}
        <div className="p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-semibold text-primary">
              🎁 {wish.cost} {wish.cost === 1 ? "балл" : wish.cost < 5 ? "балла" : "баллов"} за
              исполнение
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {wish.category}
            </span>
            <CityBadge city={wish.city} isOnline={wish.is_online} className="text-[11px]" />
            {wish.status === "hidden" ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                🌌 Скрыто — во Вселенной
              </span>
            ) : !isOpen ? (
              <span className="rounded-full bg-mint/60 px-2 py-0.5 text-[11px] font-semibold text-mint-foreground">
                {wish.status === "reserved" ? "В работе" : "Исполнено"}
              </span>
            ) : null}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{wish.title}</h1>
          {wish.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">
              {wish.description}
            </p>
          )}
          {wish.link && (
            <a
              href={wish.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium text-primary shadow-sm transition hover:bg-accent active:scale-[0.98]"
            >
              🔗 Пример подарка (ссылка)
            </a>
          )}
          <div className="mt-4 text-sm">
            <span className="text-muted-foreground">Пожелатель: </span>
            <Link
              to="/user/$userId"
              params={{ userId: wish.owner_id }}
              className="font-semibold text-primary hover:underline"
            >
              {ownerName}
            </Link>
          </div>

          <div className="mt-6 space-y-2">
            {isOwn ? (
              <>
                {(wish.status === "open" || wish.status === "hidden") && (
                  <>
                    <Button
                      onClick={toggleHidden}
                      variant="outline"
                      className="w-full rounded-2xl"
                    >
                      {wish.status === "hidden"
                        ? "🌍 Открыть для всех"
                        : "🌌 Скрыть — во Вселенную"}
                    </Button>
                    <Button
                      onClick={() => setConfirmDelete(true)}
                      variant="outline"
                      className="w-full rounded-2xl"
                    >
                      Снять с публикации
                    </Button>
                  </>
                )}
                <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Снять пожелание с публикации?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Пожелание исчезнет из ленты. Это действие нельзя отменить.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete}>Снять</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {wish.status !== "open" && wish.status !== "hidden" && (
                  <p className="rounded-2xl bg-muted p-3 text-center text-xs text-muted-foreground">
                    Это твоё пожелание — следи за ним в «Моих пожеланиях».
                  </p>
                )}
              </>
            ) : isOpen ? (
              <Button
                onClick={handleFulfill}
                disabled={loading}
                className="w-full rounded-2xl bg-mint text-mint-foreground hover:bg-mint/90"
              >
                🎁{" "}
                {loading
                  ? "Открываем чат…"
                  : `Исполнить — получить ${wish.cost} ${wish.cost === 1 ? "балл" : wish.cost < 5 ? "балла" : "баллов"}`}
              </Button>
            ) : (
              <p className="rounded-2xl bg-muted p-3 text-center text-xs text-muted-foreground">
                Уже исполняют — пожалуйста, найди другое 💚
              </p>
            )}

            <button
              type="button"
              onClick={() => shareWish(wish.id, wish.title)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent active:scale-[0.98]"
            >
              <Share2 className="h-4 w-4" /> Поделиться желанием
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
