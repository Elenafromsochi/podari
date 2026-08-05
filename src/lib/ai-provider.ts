// Выбор ИИ-провайдера по тарифу пользователя (freemium).
//
//  • free (RU)      — российский шлюз (ProxyAPI и т.п.), работает без VPN.
//  • premium (Global) — топовые мировые модели «по подписке».
//
// Всё задаётся переменными окружения, поэтому сменить модель на более новую —
// это одна строчка в настройках деплоя, без правок кода. Если Global-провайдер
// ещё не настроен, премиум тихо работает на RU-наборе (ничего не падает).

export type AIPlan = "free" | "premium";

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  /** Текстовая модель (название, описание, категории). */
  model: string;
  /** Модель генерации картинок. */
  imageModel: string;
  /** Модель распознавания речи. */
  transcribeModel: string;
}

// RU-набор (бесплатный, без VPN). Значения по умолчанию совпадают с тем,
// что уже работает в проде (на проде AI_BASE_URL переопределён на ProxyAPI).
function ruConfig(): AIConfig {
  return {
    baseUrl: process.env.AI_BASE_URL ?? "https://openrouter.ai/api/v1",
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "google/gemini-2.5-flash",
    imageModel: process.env.AI_IMAGE_MODEL ?? "gpt-image-1",
    transcribeModel: process.env.AI_TRANSCRIBE_MODEL ?? "whisper-1",
  };
}

// Global-набор (платный). Берётся, только если задан отдельный ключ ИЛИ адрес —
// иначе откатываемся на RU, чтобы премиум-фичи не падали до настройки.
function globalConfig(): AIConfig {
  const ru = ruConfig();
  const configured = !!(process.env.AI_GLOBAL_API_KEY || process.env.AI_GLOBAL_BASE_URL);
  if (!configured) return ru;
  return {
    baseUrl: process.env.AI_GLOBAL_BASE_URL ?? ru.baseUrl,
    apiKey: process.env.AI_GLOBAL_API_KEY ?? ru.apiKey,
    model: process.env.AI_GLOBAL_MODEL ?? "openai/gpt-4o",
    imageModel: process.env.AI_GLOBAL_IMAGE_MODEL ?? "gpt-image-1",
    transcribeModel: process.env.AI_GLOBAL_TRANSCRIBE_MODEL ?? "whisper-1",
  };
}

export function aiConfig(plan: AIPlan): AIConfig {
  return plan === "premium" ? globalConfig() : ruConfig();
}

// Защита от prompt injection: вырезаем управляющие конструкции,
// нормализуем переносы и режем длину. Общая для всех AI-фич (подарки,
// желания, помощник) — один источник правды.
export function sanitizeUserText(raw: string, max = 1000): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/```+/g, " ")
    .replace(/<\|[^|]*\|>/g, " ")
    .replace(/\b(system|assistant|user)\s*:/gi, " ")
    .replace(/ignore (all |the )?(previous|above) (instructions|prompt)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Запрещённые паттерны в сгенерированном тексте.
export function looksUnsafe(text: string): boolean {
  return /(system\s*:|<\|[^|]*\|>|ignore (all |the )?(previous|above))/i.test(text);
}

// Единая точка вызова AI-шлюза (chat/completions), non-streaming.
export async function callGateway(body: Record<string, unknown>, cfg: AIConfig) {
  if (!cfg.apiKey) throw new Error("ИИ не подключён: добавь AI_API_KEY");
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ ...body, model: cfg.model }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI ошибка ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Тариф пользователя: premium, пока premium_until в будущем; иначе free.
// Колонка premium_until может ещё не существовать (миграция не накатана) —
// в этом случае мягко считаем тариф бесплатным.
export async function getUserPlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<AIPlan> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("premium_until")
      .eq("user_id", userId)
      .maybeSingle();
    const until = (data as { premium_until?: string | null } | null)?.premium_until;
    if (until && new Date(until).getTime() > Date.now()) return "premium";
  } catch {
    /* колонки ещё нет — тариф бесплатный */
  }
  return "free";
}
