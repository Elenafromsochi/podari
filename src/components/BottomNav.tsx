import { Home, User, MessageCircle } from "lucide-react";
import { haptic } from "@/lib/haptics";

export type AppTab = "home" | "profile" | "chats";

interface Props {
  active: AppTab;
  onChange: (t: AppTab) => void;
  unreadChats?: number;
  achievementsBadge?: number;
}

const TABS: { id: AppTab; label: string; Icon: typeof Home }[] = [
  { id: "home", label: "Главная", Icon: Home },
  { id: "profile", label: "Профиль", Icon: User },
  { id: "chats", label: "Чаты", Icon: MessageCircle },
];

export function BottomNav({ active, onChange, unreadChats = 0, achievementsBadge = 0 }: Props) {
  return (
    <nav
      data-tour="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/80 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          const badge =
            id === "chats" ? unreadChats : id === "profile" ? achievementsBadge : 0;
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                data-tour={`tab-${id}`}
                onClick={() => {
                  if (!isActive) {
                    haptic("select");
                    onChange(id);
                  }
                }}
                className={`group relative flex w-full flex-col items-center gap-0.5 rounded-xl py-2 transition-all duration-300 ${
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <div
                  className={`relative flex h-9 w-12 items-center justify-center rounded-xl transition-all duration-300 ${
                    isActive ? "bg-primary/15 scale-100" : "scale-95"
                  }`}
                >
                  <Icon
                    className={`h-[22px] w-[22px] transition-transform duration-300 ${
                      isActive ? "scale-110" : ""
                    }`}
                    strokeWidth={isActive ? 2.4 : 2}
                  />
                  {badge > 0 && (
                    <span className="absolute -right-1 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground shadow ring-2 ring-background">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10.5px] font-medium tracking-tight transition-opacity ${
                    isActive ? "opacity-100" : "opacity-70"
                  }`}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
