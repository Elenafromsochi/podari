import { Gift, HandHeart, Sparkles, User } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { DealsFeed } from "@/components/DealsFeed";
import { WelcomeCoachmarks } from "@/components/WelcomeCoachmarks";
import type { GamePath } from "@/lib/game-state";

interface Props {
  onChoose: (path: GamePath) => void;
  userXp?: number;
}

const GREETING_KEY = "cozygift_greeted_session";

const MOTIVATIONAL_PHRASES = [
  "Сегодня отличный день, чтобы поделиться ✨",
  "Чей-то подарок уже ждёт тебя 🎁",
  "Подари — и мир станет чуть теплее 💚",
  "Маленький жест — большая радость 🌿",
  "Что подаришь миру сегодня? 💌",
  "Получать — тоже искусство 🤍",
  "Доброта возвращается бумерангом 🌀",
  "Поделись тем, что больше не нужно 🎀",
];

export function WelcomeScreen({ onChoose, userXp = 0 }: Props) {
  const heading = useMemo(() => {
    if (typeof window === "undefined") return "Привет 👋";
    const greeted = sessionStorage.getItem(GREETING_KEY);
    if (!greeted) {
      sessionStorage.setItem(GREETING_KEY, "1");
      return "Привет 👋";
    }
    return MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)];
  }, []);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center gap-8 px-5 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-peach shadow-sm">
          <Sparkles className="h-10 w-10 text-peach-foreground" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-balance text-muted-foreground">
          «Подари» — это уютный сервис, где люди дарят друг другу время, вещи и заботу.
          С чего начнём твоё приключение?
        </p>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Button
          onClick={() => onChoose("receive")}
          data-coach="receive"
          className="h-auto justify-start gap-4 rounded-2xl bg-mint px-5 py-5 text-mint-foreground shadow-sm hover:bg-mint/90"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background/60">
            <Gift className="h-5 w-5" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-base font-semibold">Получить подарок</span>
            <span className="text-xs opacity-80">Найди что-то приятное рядом</span>
          </div>
        </Button>

        <Button
          onClick={() => onChoose("give")}
          data-coach="give"
          className="h-auto justify-start gap-4 rounded-2xl bg-lavender px-5 py-5 text-lavender-foreground shadow-sm hover:bg-lavender/90"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background/60">
            <HandHeart className="h-5 w-5" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-base font-semibold">Подарить подарок</span>
            <span className="text-xs opacity-80">Поделись тем, что больше не нужно</span>
          </div>
        </Button>
      </div>

      <Link
        to="/cabinet"
        data-coach="cabinet"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <User className="h-4 w-4" /> Личный кабинет
      </Link>

      <div className="w-full">
        <DealsFeed />
      </div>

      <WelcomeCoachmarks />
    </div>
  );
}
