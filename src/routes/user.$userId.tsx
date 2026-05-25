import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/user/$userId")({
  component: UserProfilePage,
  errorComponent: ({ error, reset }) => (
    <div className="p-4">
      <p className="text-sm text-destructive">Ошибка: {error.message}</p>
      <Button onClick={reset} className="mt-3">Повторить</Button>
    </div>
  ),
  notFoundComponent: () => <div className="p-4">Профиль не найден</div>,
});

type Gift = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  cost: number;
  status: string;
};

function UserProfilePage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = useState<string>("Гость");
  const [level, setLevel] = useState<number>(1);
  const [available, setAvailable] = useState<Gift[] | null>(null);
  const [given, setGiven] = useState<Gift[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: [userId] });
      const p = (profs ?? [])[0] as { display_name?: string; level?: number } | undefined;
      if (p) {
        setName(p.display_name || "Гость");
        setLevel(p.level ?? 1);
      }
      const { data } = await supabase
        .from("gifts")
        .select("id,title,description,image_url,cost,status")
        .eq("owner_id", userId)
        .in("status", ["available", "gifted"])
        .order("created_at", { ascending: false });
      const rows = (data as Gift[]) ?? [];
      setAvailable(rows.filter((g) => g.status === "available"));
      setGiven(rows.filter((g) => g.status === "gifted"));
    })();
  }, [userId]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <button
        onClick={() => navigate({ to: "/" })}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-peach text-2xl">
          🎁
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <div className="text-sm text-muted-foreground">Уровень {level}</div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="pt-2 text-lg font-medium">Выложенные подарки</h2>
        {available === null ? (
          <Skeleton className="h-32 w-full" />
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока нет доступных подарков.</p>
        ) : (
          <div className="space-y-3">
            {available.map((g) => (
              <Card key={g.id} className="overflow-hidden p-0">
                {g.image_url ? (
                  <img src={g.image_url} alt={g.title} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-muted text-[9rem]">🎁</div>
                )}
                <div className="space-y-2 p-4">
                  <div className="text-xl font-semibold leading-tight break-words">{g.title}</div>
                  {g.description && (
                    <p className="whitespace-pre-wrap break-words text-base text-muted-foreground">
                      {g.description}
                    </p>
                  )}
                  <Link to="/" className="mt-2 inline-block text-sm text-primary hover:underline">
                    Перейти в ленту, чтобы забрать →
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="pt-2 text-lg font-medium">Уже подарено</h2>
        {given === null ? (
          <Skeleton className="h-24 w-full" />
        ) : given.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока не подарил ни одного подарка.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {given.map((g) => (
              <Card key={g.id} className="overflow-hidden p-0 opacity-90">
                {g.image_url ? (
                  <img src={g.image_url} alt={g.title} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-muted text-5xl">🎁</div>
                )}
                <div className="p-2">
                  <div className="line-clamp-2 text-sm font-medium leading-tight break-words">{g.title}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">подарено</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
