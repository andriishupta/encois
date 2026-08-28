import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type InlineErrorProps = {
  title?: string;
  message: string;
  onRetry?: () => unknown;
  retrying?: boolean;
};

export function InlineError({
  title = "Could not complete this request",
  message,
  onRetry,
  retrying = false,
}: InlineErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 text-destructive">
        <p className="font-medium">{title}</p>
        <p className="mt-1 break-words text-destructive/80">{message}</p>
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void onRetry()}
          disabled={retrying}
        >
          <RefreshCw
            className={retrying ? "animate-spin" : undefined}
            data-icon="inline-start"
          />
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      ) : null}
    </div>
  );
}
