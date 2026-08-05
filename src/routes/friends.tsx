import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { GlobalChrome } from "@/components/GlobalChrome";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { LevelBadge } from "@/components/LevelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { getMyNetwork } from "@/lib/cozy.functions";

export const Route = createFileRoute("/friends")({
  head: () => ({ meta: [{ title: "Мои люди — Подари" }] }),
  component: FriendsPage,
});

type GiftChip = { title: string; cost: number } | null;
type PersonCard = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  level: number;
  transaction_id?: string;
  gift?: GiftChip;
};
type Network = { referred: PersonCard[]; gaveTo: PersonCard[]; gotFrom: PersonCard[] };

function costWord(n: number) {
  return n === 1 ? "балл" : n < 5 ? "балла" : "баллов";
}

function PersonRow({ p }: { p: PersonCard }) {
  return (
    <Link
      to="/user/$userId"
      params={{ userId: p.user_id }}
      className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm transition active:scale-[0.98]"
    >
      {p.avatar_url ? (
        <img src={p.avatar_url} alt={p.display_name} className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-peach text-lg font-semibold text-peach-foreground">
          {p.display_name.trim().charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{p.display_name}</p>
        {p.gift && (
          <span className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-lg bg-mint/70 px-2 py-0.5 text-[11px] font-medium text-mint-foreground">
            🎁 <span className="truncate">{p.gift.title}</span> · {p.gift.cost}{" "}
            {costWord(p.gift.cost)}
          </span>
        )}
      </div>
      <LevelBadge level={p.level} />
    </Link>
  );
}

function FriendsPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.history.back();
    else navigate({ to: "/" });
  };

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [network, setNetwork] = useState<Network | null>(null);
  const [openSection, setOpenSection] = useState<"referred" | "gaveTo" | "gotFrom" | null>("referred");
  const networkFn = useServerFn(getMyNetwork);

  useEffect(() => {
    loadUser().then((u) => {
      setUser(u);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    networkFn({})
      .then((n) => setNetwork(n as Network))
      .catch(() => setNetwork({ referred: [], gaveTo: [], gotFrom: [] }));
  }, [user, networkFn]);

  if (!authChecked) return null;

  if (!user) {
    return (
      <GlobalChrome>
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-5 py-16 text-center">
          <p className="text-muted-foreground">Войдите, чтобы увидеть своих друзей.</p>
          <button onClick={() => navigate({ to: "/" })} className="text-sm text-primary underline-offset-4 hover:underline">
            На главную
          </button>
        </div>
      </GlobalChrome>
    );
  }

  return (
    <GlobalChrome>
      <div className="mx-auto w-full max-w-md space-y-4 px-5 pb-8 pt-5">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>

        <h1 className="text-2xl font-semibold tracking-tight">👯 Мои люди</h1>

        <CollapsibleSection
          title="Друзья по моей ссылке"
          count={network?.referred.length ?? null}
          open={openSection === "referred"}
          onToggle={() => setOpenSection((s) => (s === "referred" ? null : "referred"))}
        >
          {network === null ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : network.referred.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока никто не присоединился по вашей ссылке — пригласите друга в профиле 💚
            </p>
          ) : (
            <div className="space-y-2">
              {network.referred.map((p) => (
                <PersonRow key={p.user_id} p={p} />
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Кому я дарил(а)"
          count={network?.gaveTo.length ?? null}
          open={openSection === "gaveTo"}
          onToggle={() => setOpenSection((s) => (s === "gaveTo" ? null : "gaveTo"))}
        >
          {network === null ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : network.gaveTo.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока никому не подарили — самое время 🎁</p>
          ) : (
            <div className="space-y-2">
              {network.gaveTo.map((p) => (
                <PersonRow key={p.transaction_id ?? p.user_id} p={p} />
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Кто дарил(а) мне"
          count={network?.gotFrom.length ?? null}
          open={openSection === "gotFrom"}
          onToggle={() => setOpenSection((s) => (s === "gotFrom" ? null : "gotFrom"))}
        >
          {network === null ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : network.gotFrom.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока никто вам не дарил.</p>
          ) : (
            <div className="space-y-2">
              {network.gotFrom.map((p) => (
                <PersonRow key={p.transaction_id ?? p.user_id} p={p} />
              ))}
            </div>
          )}
        </CollapsibleSection>
      </div>
    </GlobalChrome>
  );
}
