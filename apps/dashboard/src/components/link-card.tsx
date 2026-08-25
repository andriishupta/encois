import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function LinkCardIndicator({ className }: { className?: string }) {
  return (
    <ArrowRight
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute bottom-4 right-4 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5",
        className,
      )}
    />
  );
}
