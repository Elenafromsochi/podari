import { useEffect, useRef, useState } from "react";
import { BottomNav, type AppTab } from "@/components/BottomNav";
import { AppHeader } from "@/components/AppHeader";
import { HomeTab } from "@/components/tabs/HomeTab";
import { ProfileTab } from "@/components/tabs/ProfileTab";
import { ChatsTab } from "@/components/tabs/ChatsTab";
import { getUnreadCounts } from "@/lib/cozy.functions";
import { touchLastSeen } from "@/lib/last-seen.functions";
import { setAppBadge } from "@/lib/app-badge";
import { useServerFn } from "@tanstack/react-start";
import type { UserProfile } from "@/lib/auth-state";

interface Props {
  user: UserProfile;
  onGive: () => void;
  onReceive: (query?: string) => void;
  onPickGift: (giftId: string) => void;
  onCreateWish?: () => void;
  onOpenWish?: (wishId: string) => void;
  initialTab?: AppTab;
}

export function AppShell({
  user,
  onGive,
  onReceive,
  onPickGift,
  onCreateWish,
  onOpenWish,
  initialTab = "home",
}: Props) {
  const [tab, setTab] = useState<AppTab>(initialTab);
  const [unreadChats, setUnreadChats] = useState(0);
  const [achievementsBadge, setAchievementsBadge] = useState(0);
  const unreadFn = useServerFn(getUnreadCounts);
  const touchFn = useServerFn(touchLastSeen);
  // Пока человек на вкладке «Чаты» — бейдж всегда 0, даже если запрос, начатый
  // до открытия вкладки, вернётся со старым значением (иначе циферка мигала
  // обратно из-за гонки опроса со старой отметкой last_seen).
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    touchFn({}).catch(() => {});
    const id = window.setInterval(() => touchFn({}).catch(() => {}), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [touchFn]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const lastChats =
          typeof window !== "undefined" ? localStorage.getItem("cozy_last_seen_chats") : null;
        const res = (await unreadFn({
          data: { last_seen_chats_at: lastChats, last_seen_gifts_at: null },
        })) as { chats_unread: number };
        if (!alive) return;
        const n = tabRef.current === "chats" ? 0 : (res.chats_unread ?? 0);
        setUnreadChats(n);
        setAppBadge(n);
      } catch {
        /* noop */
      }
    };
    refresh();
    const id = window.setInterval(refresh, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [unreadFn]);

  useEffect(() => {
    if (tab === "chats" && typeof window !== "undefined") {
      localStorage.setItem("cozy_last_seen_chats", new Date().toISOString());
      setUnreadChats(0);
    }
    // Гид: сообщаем о смене вкладки, чтобы туториал мог продвинуться
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cozy:tour-event", { detail: `${tab}-opened` }));
    }
  }, [tab]);

  return (
    <div
      className="relative min-h-[100dvh] bg-background"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
    >
      <AppHeader user={user} />
      <div key={tab} className="tab-reveal">
        {tab === "home" && (
          <HomeTab
            userName={user.display_name}
            onGive={onGive}
            onReceive={onReceive}
            onPickGift={onPickGift}
            onCreateWish={onCreateWish}
            onOpenWish={onOpenWish}
            onOpenProfile={() => setTab("profile")}
          />
        )}
        {tab === "profile" && (
          <ProfileTab
            user={user}
            onUnreadAchievements={setAchievementsBadge}
            onCreateWish={onCreateWish}
            onOpenWish={onOpenWish}
            onGive={onGive}
            onReceive={onReceive}
          />
        )}

        {tab === "chats" && <ChatsTab />}
      </div>

      <BottomNav
        active={tab}
        onChange={setTab}
        unreadChats={unreadChats}
        achievementsBadge={achievementsBadge}
      />
    </div>
  );
}
