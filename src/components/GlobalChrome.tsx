import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav, type AppTab } from "@/components/BottomNav";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { getUnreadCounts } from "@/lib/cozy.functions";

/**
 * Глобальная "обвязка" для страниц вне AppShell (чат, кабинет, профиль).
 * Сверху — AppHeader, снизу — BottomNav с маршрутизацией.
 */
export function GlobalChrome({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<UserProfile | null>(null);
  const [unread, setUnread] = useState(0);
  const unreadFn = useServerFn(getUnreadCounts);

  useEffect(() => {
    loadUser().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const tick = async () => {
      try {
        const last =
          typeof window !== "undefined"
            ? localStorage.getItem("cozy_last_seen_chats")
            : null;
        const r = (await unreadFn({
          data: { last_seen_chats_at: last, last_seen_gifts_at: null },
        })) as { chats_unread: number };
        if (alive) setUnread(r.chats_unread ?? 0);
      } catch {
        /* noop */
      }
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [user, unreadFn]);

  const active: AppTab = pathname.startsWith("/cabinet")
    ? "profile"
    : pathname.startsWith("/chat") || pathname === "/" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "chats"
      ? "chats"
      : "home";

  const goTab = (t: AppTab) => {
    // Сбрасываем возможный внутренний экран (чат/форму) на «/», иначе при
    // переходе на уже текущий адрес «/» состояние не обновлялось и человек
    // «застревал» в чате, хотя вкладка подсвечивалась активной.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cozy:nav-tab", { detail: t }));
    }
    if (t === "home") navigate({ to: "/" });
    else if (t === "profile") navigate({ to: "/cabinet" });
    else if (t === "chats") navigate({ to: "/", search: { tab: "chats" } as never });
  };

  return (
    <div
      className="relative min-h-[100dvh] bg-background"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
    >
      <AppHeader user={user} />
      {children}
      <BottomNav
        active={active}
        onChange={goTab}
        unreadChats={unread}
      />
    </div>
  );
}
