import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Circle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  hasPosted: boolean;
  hasReceived: boolean;
  hasGifted: boolean;
};

const SEEN_KEY = "cozygift_checklist_seen_v1";

export function OnboardingChecklist({ hasPosted, hasReceived, hasGifted }: Props) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(!!localStorage.getItem(SEEN_KEY));
  }, []);

  const items = [
    { done: hasReceived, label: "Получить первый подарок", hint: "Загляни в ленту и выбери приятное — 1 балл уже на счету." },
    { done: hasPosted, label: "Опубликовать свой подарок", hint: "+20 опыта сразу и +0,2 балла на счёт." },
    { done: hasGifted, label: "Передать подарок", hint: "+80 опыта и +0,8 балла, когда получатель подтвердит встречу." },
  ];

  const allDone = items.every((i) => i.done);
  if (allDone || dismissed) return null;

  const hide = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setDismissed(true);
  };

  const doneCount = items.filter((i) => i.done).length;
  const progress = Math.round((doneCount / items.length) * 100);

  return (
    <Card className="mb-6 border-mint/40 bg-mint/15">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">🌱 Твои первые шаги</CardTitle>
          <button
            onClick={hide}
            aria-label="Скрыть подсказку"
            className="rounded-full p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Пройди их — откроешь уровни и новые типы подарков
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {(() => {
          const current = items.find((i) => !i.done);
          if (!current) return null;
          return (
            <div className="flex items-start gap-3 rounded-xl bg-background/60 px-3 py-2">
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{current.label}</p>
                <p className="text-xs text-muted-foreground">{current.hint}</p>
              </div>
            </div>
          );
        })()}
        <Link
          to="/"
          className="mt-2 block w-full rounded-2xl bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Перейти к подаркам →
        </Link>
      </CardContent>
    </Card>
  );
}
