import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { HelpCircle, MessageCircle, LogOut, Gift as GiftIcon, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { loadUser, signOut, type UserProfile } from "@/lib/auth-state";
import {
  getMyPostedGifts,
  getMyReceivedGifts,
  getMyGiftedGifts,
  getMyChats,
  getUnreadCounts,
} from "@/lib/cozy.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { Achievements } from "@/components/Achievements";
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
      { title: "Личный кабинет — Подари" },
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
  const [authChecked, setAuthChecked] = useState(false);
  const [posted, setPosted] = useState<Gift[]>([]);
  const [received, setReceived] = useState<TxRow[]>([]);
  const [gifted, setGifted] = useState<TxRow[]>([]);
  const [chatsWithGivers, setChatsWithGivers] = useState<ChatItem[]>([]);
  const [chatsWithReceivers, setChatsWithReceivers] = useState<ChatItem[]>([]);
  const [archiveGivers, setArchiveGivers] = useState<ChatItem[]>([]);
  const [archiveReceivers, setArchiveReceivers] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("gifts");
  const [chatsUnread, setChatsUnread] = useState(0);
  const [giftsUnread, setGiftsUnread] = useState(0);

  const postedFn = useServerFn(getMyPostedGifts);
  const receivedFn = useServerFn(getMyReceivedGifts);
  const giftedFn = useServerFn(getMyGiftedGifts);
  const chatsFn = useServerFn(getMyChats);
  const unreadFn = useServerFn(getUnreadCounts);
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
      setAuthChecked(true);
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

  // Подсчёт непрочитанных: основан на отметках «последнее посещение» в localStorage
  const refreshUnread = async () => {
    try {
      const lastChats = typeof window !== "undefined" ? localStorage.getItem("cozy_last_seen_chats") : null;
      const lastGifts = typeof window !== "undefined" ? localStorage.getItem("cozy_last_seen_gifts") : null;
      const res = (await unreadFn({
        data: { last_seen_chats_at: lastChats, last_seen_gifts_at: lastGifts },
      })) as { chats_unread: number; gifts_unread: number };
      setChatsUnread(res.chats_unread ?? 0);
      setGiftsUnread(res.gifts_unread ?? 0);
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    if (!user) return;
    refreshUnread();
    const onChats = () => refreshUnread();
    const onGifts = () => refreshUnread();
    window.addEventListener("cozy:chats-activity", onChats);
    window.addEventListener("cozy:gifts-activity", onGifts);
    const id = window.setInterval(refreshUnread, 15000);
    return () => {
      window.removeEventListener("cozy:chats-activity", onChats);
      window.removeEventListener("cozy:gifts-activity", onGifts);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    if (typeof window === "undefined") return;
    const now = new Date().toISOString();
    if (val === "chats") {
      localStorage.setItem("cozy_last_seen_chats", now);
      setChatsUnread(0);
    } else if (val === "gifts") {
      localStorage.setItem("cozy_last_seen_gifts", now);
      setGiftsUnread(0);
    }
  };



  if (!authChecked) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm text-muted-foreground">
        Загружаем кабинет…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-muted-foreground">
        Войдите, чтобы открыть личный кабинет.{" "}
        <Link to="/" className="text-primary underline-offset-4 hover:underline">На главную</Link>
      </div>
    );
  }

  const sections: { title: string; emoji: string; gifts: Gift[]; empty: string }[] = [
    { title: "Выложенные", emoji: "📤", gifts: posted.filter((g) => g.status !== "gifted"), empty: "Вы пока не публиковали подарков" },
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
            <Stat
              label="Опыт"
              value={user.xp}
              hint={`За каждое действие начисляются баллы опыта:\n+20 за публикацию подарка\n+80 за вручённый подарок\n+5 или +20 за отзыв\n+10 за получение подарка`}
            />
            <Stat
              label="Уровень"
              value={user.level}
              hint={`Уровень растёт по мере накопления Опыта:\n1 уровень — от 0 до 199 очков\n2 уровень — от 200 до 499 очков\n3 уровень — от 500 до 999 очков\n4 уровень — от 1000 до 1699 очков\n5 уровень — от 1700 до 2499 очков`}
            />
            <Stat
              label="Подарочные баллы"
              value={user.balance}
              hint={`Списываются (замораживаются), когда забираешь подарок.\nНачисляются, когда твой подарок принят получателем.`}
            />
          </div>
        </CardContent>
      </Card>

      <OnboardingChecklist
        hasPosted={posted.length > 0}
        hasReceived={received.length > 0}
        hasGifted={gifted.length > 0}
      />

      <InviteCard userId={user.user_id} />

      <div className="mb-6 rounded-2xl border bg-card p-4 shadow-sm">
        <Achievements variant="preview" />
      </div>


      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="gifts" className="relative">
            🎁
            {giftsUnread > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {giftsUnread > 99 ? "99+" : giftsUnread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="chats" className="relative">
            💬
            {chatsUnread > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {chatsUnread > 99 ? "99+" : chatsUnread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="achievements">🏆</TabsTrigger>
          <TabsTrigger value="archive">🗂</TabsTrigger>
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

        <TabsContent value="achievements" className="mt-4">
          <Achievements variant="full" />
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

const PROJECT_ID = "bd25f75c-2201-409b-aa60-d7c459f781a6";
const APP_PUBLIC_URL = `https://project--${PROJECT_ID}.lovable.app`;

function getAppOrigin() {
  if (typeof window === "undefined") return APP_PUBLIC_URL;
  const host = window.location.host;
  // Используем стабильный публичный URL для шеринга, а не временный preview
  if (host.includes("id-preview--") || host.includes("localhost")) {
    return APP_PUBLIC_URL;
  }
  return window.location.origin;
}

function InviteCard({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${getAppOrigin()}/?ref=${userId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Ссылка скопирована 💚", {
        description: "Отправь её другу — за каждого получишь +50 опыта",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const share = () => {
    const text = `Привет! Дарю тебе приглашение в «Подари» — уютный сервис подарков 💚\nПо ссылке тебе сразу зачислится 1 балл на первый подарок: ${link}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    if (typeof window !== "undefined") window.open(url, "_blank");
  };

  return (
    <Card className="mb-6 border-lavender/40 bg-lavender/15">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <GiftIcon className="h-5 w-5 text-lavender-foreground" />
          Пригласи друга
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Другу — <b>+1 балл</b> на первый подарок, тебе — <b>+50 опыта</b> 💚
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2">
          <span className="flex-1 truncate text-xs text-muted-foreground">{link}</span>
          <button
            type="button"
            onClick={copy}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="Скопировать ссылку"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <Button onClick={share} className="w-full gap-2 bg-lavender text-lavender-foreground hover:bg-lavender/90">
          📤 Поделиться в Telegram
        </Button>
      </CardContent>
    </Card>
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
          <PopoverContent side="bottom" className="w-64 whitespace-pre-line text-xs leading-relaxed">{hint}</PopoverContent>
        </Popover>
      )}
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
