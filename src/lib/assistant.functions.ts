import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  aiConfig,
  getUserPlan,
  sanitizeUserText,
  looksUnsafe,
  callGateway,
} from "@/lib/ai-provider";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant-knowledge";

const MAX_MESSAGE_LEN = 500;
const MAX_HISTORY_TURNS = 8;

type HistoryTurn = { role: "user" | "assistant"; content: string };

/**
 * FAQ-помощник по сервису. Без памяти на сервере — клиент присылает
 * последние реплики диалога каждый раз (v1: история живёт только в
 * состоянии виджета на время сессии, не сохраняется в БД).
 */
export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { message: string; history?: HistoryTurn[] }) => {
    const message = String(input?.message ?? "").trim();
    if (!message) throw new Error("Сообщение не может быть пустым");
    if (message.length > MAX_MESSAGE_LEN) throw new Error("Слишком длинное сообщение");
    const rawHistory = Array.isArray(input?.history) ? input.history : [];
    const history = rawHistory
      .filter(
        (t): t is HistoryTurn =>
          !!t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string",
      )
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_LEN) }));
    return { message, history };
  })
  .handler(async ({ data, context }): Promise<{ reply: string }> => {
    try {
      const cfg = aiConfig(await getUserPlan(context.supabase, context.userId));
      const json = await callGateway(
        {
          messages: [
            { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
            ...data.history.map((t) => ({
              role: t.role,
              content: sanitizeUserText(t.content, MAX_MESSAGE_LEN),
            })),
            { role: "user", content: sanitizeUserText(data.message, MAX_MESSAGE_LEN) },
          ],
        },
        cfg,
      );
      let reply = String(json?.choices?.[0]?.message?.content ?? "").trim();
      if (!reply || looksUnsafe(reply)) {
        reply =
          "Не удалось сформулировать ответ — попробуй переформулировать вопрос или напиши админу 💌";
      }
      return { reply };
    } catch (e) {
      console.error("[assistant] askAssistant failed", e);
      return {
        reply: "Сейчас не получилось ответить — попробуй ещё раз чуть позже 🙏",
      };
    }
  });
