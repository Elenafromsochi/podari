// Автоматическое ежедневное напоминание «уснувшим» пользователям —
// без ручного запуска из админки. Переиспользует определение «уснувшего»
// (см. admin.functions.ts, SLEEP_DAYS) и тот же батчинг отправки, что и
// ручная рассылка (sendTelegramBroadcast).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tgApiSafe } from "@/lib/telegram-api";
import { APP_BASE_URL } from "@/lib/app-url";

const SLEEP_DAYS = 3;
const RENUDGE_AFTER_DAYS = 4;
const RECENT_DAYS = 2;
const MAX_CANDIDATES = 300;

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

async function sendOne(chatId: number, text: string) {
  await tgApiSafe("sendMessage", {
    chat_id: chatId,
    text,
    disable_notification: true,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "Открыть «Подари» 💚", url: APP_BASE_URL }]],
    },
  });
}

/** Живая статистика платформы за последние RECENT_DAYS дней — для соцдоказательства в нудже. */
async function getRecentStats() {
  const since = daysAgo(RECENT_DAYS);
  const [gifted, posted, wished] = await Promise.all([
    supabaseAdmin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("created_at", since),
    supabaseAdmin
      .from("gifts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    supabaseAdmin
      .from("wishes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
  ]);
  return {
    gifted: gifted.count ?? 0,
    posted: posted.count ?? 0,
    wished: wished.count ?? 0,
  };
}

function pickStatsMessage(stats: { gifted: number; posted: number; wished: number }): string {
  const templates: string[] = [];
  if (stats.gifted > 0) {
    templates.push(`Уже ${stats.gifted} подарков получили за последние дни — забери свой 🎁`);
  }
  if (stats.posted > 0) {
    templates.push(`Выложили ${stats.posted} новых подарков за последние дни — выбери свой 🎁`);
  }
  if (stats.wished > 0) {
    templates.push(`${stats.wished} человек загадали желание за последние дни — загадай своё ✨`);
  }
  if (templates.length === 0) return "Загляни, что нового в «Подари» 💚";
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Раз в прогон: находит «уснувших» (не заходили SLEEP_DAYS+ и не получали
 * нудж последние RENUDGE_AFTER_DAYS), для каждого выбирает текст — сначала
 * личное незакрытое дело, иначе живая статистика платформы — и шлёт молча
 * в Telegram-бота. Никогда не бросает исключение наружу.
 */
export async function runSleepingNudgeSweep(): Promise<void> {
  try {
    // Каст через any: last_reengagement_sent_at ещё не попал в сгенерированные
    // типы (та же ситуация, что с avatar_url/about/city в этом проекте) — сам
    // столбец в базе есть, это только рассинхрон типов.
    const { data, error } = await (supabaseAdmin.from("profiles") as any)
      .select("user_id, telegram_id, last_reengagement_sent_at")
      .not("telegram_id", "is", null)
      .or(`last_seen_at.lt.${daysAgo(SLEEP_DAYS)},last_seen_at.is.null`)
      .order("last_seen_at", { ascending: true, nullsFirst: true })
      .limit(2000);
    if (error) throw error;
    const sleepingRows = (data ?? []) as Array<{
      user_id: string;
      telegram_id: number;
      last_reengagement_sent_at: string | null;
    }>;

    // Повторный нудж не чаще раза в RENUDGE_AFTER_DAYS — фильтруем в JS,
    // чтобы не комбинировать два .or() в одном запросе (PostgREST этого не ждёт).
    const renudgeCutoff = daysAgo(RENUDGE_AFTER_DAYS);
    const candidates = sleepingRows
      .filter((c) => !c.last_reengagement_sent_at || c.last_reengagement_sent_at < renudgeCutoff)
      .slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) return;

    const ids = candidates.map((c) => c.user_id as string);

    // Личное незакрытое дело: активная бронь, где кандидат — даритель или получатель.
    const { data: pendingTx } = await supabaseAdmin
      .from("transactions")
      .select("sender_id, receiver_id")
      .eq("status", "pending")
      .or(`sender_id.in.(${ids.join(",")}),receiver_id.in.(${ids.join(",")})`);
    const withPending = new Set<string>();
    for (const t of pendingTx ?? []) {
      if (t.sender_id) withPending.add(t.sender_id as string);
      if (t.receiver_id) withPending.add(t.receiver_id as string);
    }

    const stats = await getRecentStats();
    const statsText = pickStatsMessage(stats);
    const sentIds: string[] = [];

    for (let i = 0; i < candidates.length; i += 25) {
      const batch = candidates.slice(i, i + 25);
      const results = await Promise.allSettled(
        batch.map((c) => {
          const text = withPending.has(c.user_id as string)
            ? "У тебя есть бронь, которую пора передать или забрать 🎁 Загляни в «Подари»"
            : statsText;
          return sendOne(Number(c.telegram_id), text);
        }),
      );
      results.forEach((res, idx) => {
        if (res.status === "fulfilled") sentIds.push(batch[idx].user_id as string);
      });
      if (i + 25 < candidates.length) await new Promise((r) => setTimeout(r, 1100));
    }

    if (sentIds.length > 0) {
      await (supabaseAdmin.from("profiles") as any)
        .update({ last_reengagement_sent_at: new Date().toISOString() })
        .in("user_id", sentIds);
    }
  } catch (e) {
    console.error("[reengagement] sweep failed", e);
  }
}
