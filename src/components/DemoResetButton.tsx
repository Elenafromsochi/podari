import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resetState } from "@/lib/game-state";

export function DemoResetButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        resetState();
        window.location.reload();
      }}
      className="fixed right-3 top-3 z-50 gap-1.5 rounded-full bg-card/80 text-xs text-muted-foreground backdrop-blur hover:text-foreground"
    >
      <RotateCcw className="h-3.5 w-3.5" />
      Сбросить игру
    </Button>
  );
}
