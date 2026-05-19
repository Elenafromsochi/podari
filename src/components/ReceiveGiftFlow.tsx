import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Gift = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
};

type Step = "categories" | "feed";

export function ReceiveGiftFlow({
  onBack,
  onPick,
}: {
  onBack: () => void;
  onPick: (giftId: string) => void;
}) {
  const [step, setStep] = useState<Step>("categories");
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("gifts")
        .select("id,title,description,category,image_url")
        .eq("status", "available")
        .order("created_at", { ascending: false });
      setGifts((data as Gift[]) ?? []);
    })();
  }, []);

  if (!gifts) {
    return (
      <div className="mx-auto w-full max-w-md space-y-3 px-5 py-10">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (step === "categories") {
    const counts = new Map<string, number>();
    for (const g of gifts) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    return (
      <div className="mx-auto w-full max-w-md px-5 py-8">
        <button
          onClick={onBack}
          className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад
        </button>
        <h2 className="mb-1 text-2xl font-semibold">Выбери категорию</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Что бы ты хотел получить? Доступно {gifts.length}{" "}
          {gifts.length === 1 ? "подарок" : "подарков"}.
        </p>

        {cats.length === 0 ? (
          <p className="text-muted-foreground">Пока нет активных подарков 💚</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cats.map(([cat, n]) => (
              <button
                key={cat}
                onClick={() => {
                  setCategory(cat);
                  setStep("feed");
                }}
                className="rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:bg-accent"
              >
                <div className="text-base font-medium capitalize">{cat}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {n} {n === 1 ? "подарок" : "подарков"}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const filtered = gifts.filter((g) => g.category === category);

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <button
        onClick={() => setStep("categories")}
        className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← К категориям
      </button>
      <h2 className="mb-1 text-2xl font-semibold capitalize">{category}</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "подарок" : "подарков"} доступно
      </p>

      <div className="space-y-3">
        {filtered.map((g) => (
          <Card
            key={g.id}
            className="flex cursor-pointer gap-3 overflow-hidden p-3 transition hover:bg-accent"
            onClick={() => onPick(g.id)}
          >
            {g.image_url ? (
              <img
                src={g.image_url}
                alt={g.title}
                className="h-20 w-20 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted text-2xl">
                🎁
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{g.title}</div>
              {g.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {g.description}
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
