import { useEffect, useState } from "react";
import { BottomNav, type AppTab } from "@/components/BottomNav";
import { AppHeader } from "@/components/AppHeader";
import { HomeTab } from "@/components/tabs/HomeTab";
import { ProfileTab } from "@/components/tabs/ProfileTab";
import { ChatsTab } from "@/components/tabs/ChatsTab";
import { getUnreadCounts } from "@/lib/cozy.functions";
import { touchLastSeen } from "@/lib/last-seen.functions";
import { useServerFn } from "@tanstack/react-start";
import type { UserProfile } from "@/lib/auth-state";

interface Props {
  user: UserProfile;
  onGive: () => void;
  onReceive: () => void;
  onPickGift: (giftId: string) => void;
  onCreateWish?: () => void;
  onOpenWish?: (wishId: string) => void;
  initialTab?: AppTab;
}

export function AppShell({ user, onGive, onReceive, onPickGift, onCreateWish, onOpenWish, initialTab = "home" }: Props) {
  const [tab, setTab] = useState<AppTab>(initialTab);
  const [unreadChats, setUnreadChats] = useState(0);
  const [achievementsBadge, setAchievementsBadge] = useState(0);
  const unreadFn = useServerFn(getUnreadCounts);
  const touchFn = useServerFn(touchLastSeen);

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
        setUnreadChats(res.chats_unread ?? 0);
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
  }, [tab]);

  return (
    <div
      className="relative min-h-[100dvh] bg-background"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
    >
      <AppHeader
        user={user}
        unreadChats={unreadChats}
        onMessagesClick={() => setTab("chats")}
      />
      <div key={tab} className="tab-reveal">
        {tab === "home" && (
          <HomeTab
            userName={user.display_name}
            onGive={onGive}
            onReceive={onReceive}
            onPickGift={onPickGift}
            onCreateWish={onCreateWish}
            onOpenWish={onOpenWish}
          />
        )}
        {tab === "profile" && (
          <ProfileTab
            user={user}
            onUnreadAchievements={setAchievementsBadge}
            onCreateWish={onCreateWish}
            onOpenWish={onOpenWish}
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
