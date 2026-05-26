import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadUser, signOut, type UserProfile } from "@/lib/auth-state";
import { setPassword } from "@/lib/password-auth.functions";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";

export const Route = createFileRoute("/set-password")({
  head: () => ({
    meta: [
      { title: "Задай пароль — Подари" },
      { name: "description", content: "Установите пароль для входа в сервис" },
    ],
  }),
  component: SetPasswordPage,
});

function SetPasswordPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [checked, setChecked] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const setPwdFn = useServerFn(setPassword);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u = await loadUser();
      if (!mounted) return;
      setUser(u);
      setChecked(true);
      if (!u) {
        navigate({ to: "/" });
      } else if (u.password_set) {
        navigate({ to: "/" });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (pwd.length < 8) {
      toast.error("Пароль должен быть не короче 8 символов");
      return;
    }
    if (pwd.length > 128) {
      toast.error("Слишком длинный пароль");
      return;
    }
    if (pwd !== pwd2) {
      toast.error("Пароли не совпадают");
      return;
    }
    setLoading(true);
    try {
      await setPwdFn({
        data: {
          password: pwd,
          device_id: getDeviceId(),
          device_label: getDeviceLabel(),
        },
      });
      toast.success("Пароль установлен 🔒", {
        description: "В следующий раз войди по @username и паролю",
      });
      navigate({ to: "/" });
      if (typeof window !== "undefined") {
        // обновим профиль
        window.dispatchEvent(new Event("cozy:password-set"));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let text = "Не удалось сохранить пароль";
      if (/pwned|leaked|HIBPError/i.test(msg))
        text =
          "Этот пароль найден в утечках — выбери другой, посложнее";
      else if (/weak|short/i.test(msg)) text = "Слишком простой пароль";
      toast.error(text, { description: msg });
    } finally {
      setLoading(false);
    }
  };

  if (!checked) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm text-muted-foreground">
        Загружаем...
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-mint shadow-sm">
          <Lock className="h-7 w-7 text-mint-foreground" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {user.password_set ? "Сменить пароль" : "Задай пароль"}
        </h1>
        <p className="text-balance text-sm text-muted-foreground">
          Теперь вход — по <b>@{user.telegram_username ?? "username"}</b> и
          паролю. Telegram-код будет нужен только на новом устройстве.
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pwd">Новый пароль</Label>
          <div className="relative">
            <Input
              id="pwd"
              type={show ? "text" : "password"}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="не короче 8 символов"
              autoComplete="new-password"
              disabled={loading}
              className="h-12 rounded-xl pr-12 text-base"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
              aria-label={show ? "Скрыть" : "Показать"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="pwd2">Повтори пароль</Label>
          <Input
            id="pwd2"
            type={show ? "text" : "password"}
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            autoComplete="new-password"
            disabled={loading}
            className="h-12 rounded-xl text-base"
          />
        </div>

        <Button
          type="submit"
          disabled={loading || pwd.length < 8 || pwd !== pwd2}
          className="h-14 rounded-2xl bg-mint text-base font-semibold text-mint-foreground shadow-sm hover:bg-mint/90"
        >
          {loading ? "Сохраняем..." : "Сохранить пароль"}
        </Button>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Пароль зашифрован, мы его не
          видим
        </p>

        {user.password_set && (
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Выйти
          </button>
        )}
      </form>
    </div>
  );
}
