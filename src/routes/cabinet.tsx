import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadState, type GameState } from "@/lib/game-state";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const Route = createFileRoute("/cabinet")({
  head: () => ({
    meta: [
      { title: "Личный кабинет — CozyGift" },
      { name: "description", content: "Ваш прогресс, XP и подарки" },
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
  created_at: string;
};

function CabinetPage() {
  const [state, setState] = useState<GameState | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [gifts, setGifts] = useState<Record<string, Gift>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = loadState();
    setState(s);
    setUser(loadUser());
    const ids = Array.from(
      new Set([...s.giftsPosted, ...s.giftsGifted, ...s.giftsReceived]),
    );
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    supabase
      .from("gifts")
      .select("id,title,category,description,image_url,status,created_at")
      .in("id", ids)
      .then(({ data }) => {
        const map: Record<string, Gift> = {};
        (data ?? []).forEach((g) => (map[g.id] = g as Gift));
        setGifts(map);
        setLoading(false);
      });
  }, []);

  if (!state) return null;

  const sections: { title: string; emoji: string; ids: string[]; empty: string }[] = [
    {
      title: "Выложенные",
      emoji: "📤",
      ids: state.giftsPosted,
      empty: "Вы пока не публиковали подарков",
    },
    {
      title: "Подаренные",
      emoji: "💝",
      ids: state.giftsGifted,
      empty: "Пока никому не передали подарок",
    },
    {
      title: "Полученные",
      emoji: "🎁",
      ids: state.giftsReceived,
      empty: "Вы пока ничего не получили",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <Link
        to="/"
        className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← На главную
      </Link>

      <Card className="mb-6 border-primary/20 bg-card/80">
        <CardHeader>
          <CardTitle className="text-2xl">✨ Личный кабинет</CardTitle>
          {user?.name && (
            <p className="text-sm text-muted-foreground">Привет, {user.name}!</p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat
              label="XP"
              value={state.xp}
              hint="XP — опыт в игре. Начисляется за каждое действие: +20 за публикацию подарка, +40 за подтверждение получения, +80 за вручённый подарок, +40 за отзыв. По мере накопления XP растёт ваш уровень."
            />
            <Stat
              label="Уровень"
              value={state.level}
              hint="Уровень растёт по мере накопления XP. Каждые 200 XP — новый уровень. На новых уровнях открываются особые категории подарков и бонусы."
            />
            <Stat
              label="L-баллы"
              value={user?.l_points_balance ?? state.balance}
              hint="L-баллы — внутренняя валюта мира подарков. 100 баллов начислены при регистрации в подарок. Тратятся, когда вы выбираете подарок (резервируются на безопасной сделке), и возвращаются как награда за активность."
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {sections.map((sec) => (
          <section key={sec.title}>
            <h2 className="mb-2 text-lg font-semibold">
              {sec.emoji} {sec.title}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({sec.ids.length})
              </span>
            </h2>
            {sec.ids.length === 0 ? (
              <p className="rounded-md bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                {sec.empty}
              </p>
            ) : loading ? (
              <p className="text-sm text-muted-foreground">Загружаем...</p>
            ) : (
              <ul className="space-y-2">
                {sec.ids
                  .map((id) => gifts[id])
                  .filter(Boolean)
                  .map((g) => (
                    <li
                      key={g.id}
                      className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm"
                    >
                      {g.image_url ? (
                        <img
                          src={g.image_url}
                          alt={g.title}
                          className="h-16 w-16 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-2xl">
                          🎁
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{g.title}</p>
                        <p className="text-xs text-muted-foreground">{g.category}</p>
                        {g.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {g.description}
                          </p>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-mint/30 px-2 py-3">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
