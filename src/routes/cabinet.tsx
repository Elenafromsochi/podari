import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { HelpCircle, MessageCircle, LogOut } from "lucide-react";
import { toast } from "sonner";
import { loadUser, signOut, type UserProfile } from "@/lib/auth-state";
import {
  getMyPostedGifts,
  getMyReceivedGifts,
  getMyGiftedGifts,
  getMyChats,
} from "@/lib/cozy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/cabinet")({
  head: () => ({
    meta: [
      { title: "Личный кабинет — CozyGift" },
      { name: "description", content: "Ваш прогресс, Опыт и подарки" },
    ],
  }),
  component: CabinetPage,
});

type Gift = {
  id: string;
  title: string;
  category: string;
  description: string | null;
  image_url: string | null;
  status: string;
};

type TxRow = { id: string; status: string; gift: Gift | null };

type ChatItem = {
  transaction_id: string;
  status: string;
  gift_id: string;
  gift_title: string;
  gift_image: string | null;
  other_name: string;
  created_at: string;
};

function CabinetPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [posted, setPosted] = useState<Gift[]>([]);
  const [received, setReceived] = useState<TxRow[]>([]);
  const [gifted, setGifted] = useState<TxRow[]>([]);
  const [chatsWithGivers, setChatsWithGivers] = useState<ChatItem[]>([]);
  const [chatsWithReceivers, setChatsWithReceivers] = useState<ChatItem[]>([]);
  const [archiveGivers, setArchiveGivers] = useState<ChatItem[]>([]);
  const [archiveReceivers, setArchiveReceivers] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);

  const postedFn = useServerFn(getMyPostedGifts);
  const receivedFn = useServerFn(getMyReceivedGifts);
  const giftedFn = useServerFn(getMyGiftedGifts);
  const chatsFn = useServerFn(getMyChats);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Вы вышли из аккаунта");
      navigate({ to: "/" });
      if (typeof window !== "undefined") window.location.reload();
    } catch (e) {
      toast.error("Не удалось выйти", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    (async () => {
      const u = await loadUser();
      setUser(u);
      if (!u) {
        setLoading(false);
        return;
      }
      try {
        const [p, r, g, c] = await Promise.all([
          postedFn(),
          receivedFn(),
          giftedFn(),
          chatsFn(),
        ]);
        setPosted((p as Gift[]) ?? []);
        setReceived((r as TxRow[]) ?? []);
        setGifted((g as TxRow[]) ?? []);
        const chats = c as {
          with_givers: ChatItem[];
          with_receivers: ChatItem[];
          archive_with_givers?: ChatItem[];
          archive_with_receivers?: ChatItem[];
        };
        setChatsWithGivers(chats?.with_givers ?? []);
        setChatsWithReceivers(chats?.with_receivers ?? []);
        setArchiveGivers(chats?.archive_with_givers ?? []);
        setArchiveReceivers(chats?.archive_with_receivers ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [postedFn, receivedFn, giftedFn, chatsFn]);

  if (!user) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-muted-foreground">
        Войдите, чтобы открыть личный кабинет.{" "}
        <Link to="/" className="text-primary underline-offset-4 hover:underline">На главную</Link>
      </div>
    );
  }

  const sections: { title: string; emoji: string; gifts: Gift[]; empty: string }[] = [
    { title: "Выложенные", emoji: "📤", gifts: posted, empty: "Вы пока не публиковали подарков" },
    { title: "Подаренные", emoji: "💝", gifts: gifted.map((t) => t.gift).filter((g): g is Gift => !!g), empty: "Пока никому не передали подарок" },
    { title: "Полученные", emoji: "🎁", gifts: received.map((t) => t.gift).filter((g): g is Gift => !!g), empty: "Вы пока ничего не получили" },
  ];

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <Link to="/" className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">← На главную</Link>

      <Card className="mb-6 border-primary/20 bg-card/80">
        <CardHeader>
          <CardTitle className="text-2xl">✨ Личный кабинет</CardTitle>
          <p className="text-sm text-muted-foreground">Привет, {user.display_name}!</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Опыт" value={user.xp} hint="Начисляется за каждое действие: +20 за публикацию подарка, +80 за вручённый подарок, +20 за отзыв, +10 за получение подарка." />
            <Stat label="Уровень" value={user.level} hint="Уровень растёт по мере накопления Опыта. Каждые 200 Опыта — новый уровень." />
            <Stat label="Подарочные баллы" value={user.balance} hint="Расход: списываются (замораживаются), когда забираешь подарок. Доход: возвращаются, когда твой подарок принят получателем." />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="gifts" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="gifts">🎁 Подарки</TabsTrigger>
          <TabsTrigger value="chats">💬 Чаты</TabsTrigger>
          <TabsTrigger value="archive">🗂 Архив</TabsTrigger>
        </TabsList>

        <TabsContent value="gifts" className="mt-4 space-y-6">
          {sections.map((sec) => (
            <section key={sec.title}>
              <h2 className="mb-2 text-lg font-semibold">
                {sec.emoji} {sec.title}{" "}
                <span className="text-sm font-normal text-muted-foreground">({sec.gifts.length})</span>
              </h2>
              {sec.gifts.length === 0 ? (
                <p className="rounded-md bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                  {loading ? "Загружаем..." : sec.empty}
                </p>
              ) : (
                <ul className="space-y-2">
                  {sec.gifts.map((g) => (
                    <li key={g.id} className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm">
                      {g.image_url ? (
                        <img src={g.image_url} alt={g.title} className="h-16 w-16 shrink-0 rounded-md object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-2xl">🎁</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{g.title}</p>
                        <p className="text-xs text-muted-foreground">{g.category} • {g.status}</p>
                        {g.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{g.description}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </TabsContent>

        <TabsContent value="chats" className="mt-4 space-y-4">
          <ChatGroup
            title="С дарителями"
            emoji="🎁"
            empty="Здесь появятся активные чаты по подаркам, которые вы выбрали"
            items={chatsWithGivers}
            loading={loading}
          />
          <ChatGroup
            title="С получателями"
            emoji="💝"
            empty="Здесь появятся активные чаты с теми, кто выбрал ваш подарок"
            items={chatsWithReceivers}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="archive" className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Сюда попадают чаты после завершения или отказа от подарка
          </p>
          <ChatGroup
            title="С дарителями"
            emoji="🎁"
            empty="Здесь пока нет завершённых чатов"
            items={archiveGivers}
            loading={loading}
          />
          <ChatGroup
            title="С получателями"
            emoji="💝"
            empty="Здесь пока нет завершённых чатов"
            items={archiveReceivers}
            loading={loading}
          />
        </TabsContent>
      </Tabs>

      <div className="mt-8 border-t pt-6">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <LogOut className="h-4 w-4" /> Выйти из аккаунта
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Выйти из аккаунта?</AlertDialogTitle>
              <AlertDialogDescription>
                Сессия будет сброшена. Чтобы вернуться, потребуется снова войти по номеру телефона.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleSignOut}>Выйти</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function ChatGroup({
  title,
  emoji,
  empty,
  items,
  loading,
}: {
  title: string;
  emoji: string;
  empty: string;
  items: ChatItem[];
  loading: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        {emoji} {title}{" "}
        <span className="text-xs">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="rounded-md bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          {loading ? "Загружаем..." : empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.transaction_id}>
              <Link
                to="/chat/$giftId"
                params={{ giftId: it.gift_id }}
                className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition hover:bg-accent"
              >
                {it.gift_image ? (
                  <img
                    src={it.gift_image}
                    alt={it.gift_title}
                    className="h-12 w-12 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted text-xl">
                    🎁
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.gift_title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {it.other_name} •{" "}
                    {it.status === "completed" ? "завершено" : "в процессе"}
                  </p>
                </div>
                <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="relative rounded-xl bg-mint/30 px-2 py-3">
      {hint && (
        <Popover>
          <PopoverTrigger
            aria-label={`Подробнее: ${label}`}
            className="absolute right-1.5 top-1.5 text-muted-foreground transition hover:text-foreground"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent side="bottom" className="w-64 text-xs leading-relaxed">{hint}</PopoverContent>
        </Popover>
      )}
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
