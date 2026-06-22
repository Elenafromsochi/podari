import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getGiftForEdit } from "@/lib/cozy.functions";
import { GiftEditForm, type EditGift } from "@/components/GiftEditForm";
import { loadUser, type UserProfile } from "@/lib/auth-state";
import { GlobalChrome } from "@/components/GlobalChrome";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/gift/$giftId/edit")({
  component: EditGiftPage,
});

function EditGiftPage() {
  const { giftId } = Route.useParams();
  const navigate = useNavigate();
  const loadFn = useServerFn(getGiftForEdit);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [gift, setGift] = useState<EditGift | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const u = await loadUser();
      setUser(u);
      if (!u) {
        navigate({ to: "/" });
        return;
      }
      try {
        const g = await loadFn({ data: { id: giftId } });
        setGift(g as EditGift);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          msg.includes("NOT_OWNER")
            ? "Это не твой подарок — редактировать может только владелец."
            : msg.includes("GIFT_NOT_FOUND")
              ? "Подарок не найден."
              : "Не удалось загрузить подарок.",
        );
        setGift(null);
      }
    })();
  }, [giftId, loadFn, navigate]);

  const goToGift = () => navigate({ to: "/gift/$giftId", params: { giftId } });

  return (
    <GlobalChrome>
      <div className="mx-auto w-full max-w-md">
        {gift === undefined ? (
          <div className="space-y-3 px-5 py-6">
            <Skeleton className="h-8 w-40 rounded-xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : gift === null ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={goToGift}
              className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              К подарку
            </button>
          </div>
        ) : (
          <GiftEditForm
            gift={gift}
            userLevel={user?.level ?? 1}
            onBack={goToGift}
            onDone={goToGift}
          />
        )}
      </div>
    </GlobalChrome>
  );
}
