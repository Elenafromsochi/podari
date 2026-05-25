import { Link } from "@tanstack/react-router";
import { Check, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  hasPosted: boolean;
  hasReceived: boolean;
  hasGifted: boolean;
};

export function OnboardingChecklist({ hasPosted, hasReceived, hasGifted }: Props) {
  const items = [
    { done: hasReceived, label: "Получить первый подарок", hint: "Загляни в ленту и выбери приятное — 1 балл уже на счету." },
    { done: hasPosted, label: "Опубликовать свой подарок", hint: "+20 опыта сразу и +0,2 балла на счёт." },
    { done: hasGifted, label: "Передать подарок", hint: "+80 опыта и +0,8 балла, когда получатель подтвердит встречу." },
  ];

  const allDone = items.every((i) => i.done);
  if (allDone) return null;

  const doneCount = items.filter((i) => i.done).length;
  const progress = Math.round((doneCount / items.length) * 100);

  return (
    <Card className="mb-6 border-mint/40 bg-mint/15">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">🌱 Твои первые шаги</CardTitle>
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
        {items.map((it) => (
          <div
            key={it.label}
            className={`flex items-start gap-3 rounded-xl px-3 py-2 transition ${
              it.done ? "opacity-60" : "bg-background/60"
            }`}
          >
            {it.done ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${it.done ? "line-through" : ""}`}>
                {it.label}
              </p>
              {!it.done && (
                <p className="text-xs text-muted-foreground">{it.hint}</p>
              )}
            </div>
          </div>
        ))}
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
