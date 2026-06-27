import { useState } from "react";
import { Search } from "lucide-react";
import { WishesFeed } from "@/components/WishesFeed";

interface Props {
  onBack: () => void;
  /** Открыть желание (чтобы исполнить его). */
  onOpen: (wishId: string) => void;
}

/**
 * «Подарить то, что хотят другие» — лента чужих желаний. Человек выбирает
 * желание и исполняет его. Кнопку «Загадать желание» здесь прячем: это путь
 * дарения, а не загадывания.
 */
export function GiveWishes({ onBack, onOpen }: Props) {
  const [query, setQuery] = useState("");

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <button
        onClick={onBack}
        className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Назад
      </button>
      <h2 className="mb-2 text-2xl font-semibold tracking-tight">Что хотят другие ✨</h2>
      <p className="mb-5 text-balance text-muted-foreground">
        Выбери желание из ленты и исполни его — кому-то это очень нужно 💚
      </p>

      <div className="mb-4 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-sm">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти желание…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>

      <WishesFeed onOpen={onOpen} onCreate={() => {}} searchQuery={query} hideCreate />
    </div>
  );
}
