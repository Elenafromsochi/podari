import { createServerFn } from "@tanstack/react-start";

const CATEGORIES = ["книги", "медитации", "кофе", "музыка", "еда", "разное"];

export const generateGiftMeta = createServerFn({ method: "POST" })
  .inputValidator((input: { description: string; hasImage?: boolean }) => {
    const d = String(input?.description ?? "").trim();
    if (!d) throw new Error("Описание не может быть пустым");
    if (d.length > 2000) throw new Error("Слишком длинное описание");
    return { description: d, hasImage: Boolean(input?.hasImage) };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY не настроен");

    const system = `Ты помощник в сервисе обмена подарками. По описанию подарка придумай короткое уютное название (3–6 слов, без кавычек) и подбери категорию строго из списка: ${CATEGORIES.join(", ")}. Отвечай только JSON.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Описание подарка${data.hasImage ? " (с фото)" : ""}:\n${data.description}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "set_gift_meta",
              description: "Сохранить название и категорию подарка",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", minLength: 2, maxLength: 80 },
                  category: { type: "string", enum: CATEGORIES },
                },
                required: ["title", "category"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "set_gift_meta" } },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI ошибка ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { title?: string; category?: string } = {};
    try {
      parsed = call ? JSON.parse(call) : {};
    } catch {
      parsed = {};
    }
    const title = (parsed.title || "Подарок").toString().slice(0, 80).trim();
    const category = CATEGORIES.includes(parsed.category || "")
      ? (parsed.category as string)
      : "разное";
    return { title, category };
  });
