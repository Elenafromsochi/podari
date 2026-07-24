import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Сворачиваемый раздел: заголовок + счётчик + стрелочка, содержимое — по тапу. */
export function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number | null;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left transition active:bg-accent/50"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          {title}
          {count !== null && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
              {count}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="space-y-3 border-t bg-background/40 p-4">{children}</div>}
    </section>
  );
}
