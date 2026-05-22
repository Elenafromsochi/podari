import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { HelpCircle, MessageCircle } from "lucide-react";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import {
  getMyPostedGifts,
  getMyReceivedGifts,
  getMyGiftedGifts,
  getMyChats,
} from "@/lib/cozy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

function CabinetPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [posted, setPosted] = useState<Gift[]>([]);
  const [received, setReceived] = useState<TxRow[]>([]);
  const [gifted, setGifted] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);

  const postedFn = useServerFn(getMyPostedGifts);
  const receivedFn = useServerFn(getMyReceivedGifts);
  const giftedFn = useServerFn(getMyGiftedGifts);

  useEffect(() => {
    (async () => {
      const u = await loadUser();
      setUser(u);
      if (!u) {
        setLoading(false);
        return;
      }
      try {
        const [p, r, g] = await Promise.all([postedFn(), receivedFn(), giftedFn()]);
        setPosted((p as Gift[]) ?? []);
        setReceived((r as TxRow[]) ?? []);
        setGifted((g as TxRow[]) ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [postedFn, receivedFn, giftedFn]);

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
            <Stat label="Опыт" value={user.xp} hint="Начисляется за каждое действие: +20 за публикацию подарка, +80 за вручённый подарок, +20 за отзыв, +20 за получение подарка. По мере накопления Опыта растёт Уровень." />
            <Stat label="Уровень" value={user.level} hint="Уровень растёт по мере накопления Опыта. Каждые 200 Опыта — новый уровень." />
            <Stat label="Подарочные баллы" value={user.balance} hint="Расход: списываются (замораживаются), когда забираешь подарок. Доход: возвращаются, когда твой подарок принят получателем." />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
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
      </div>
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
