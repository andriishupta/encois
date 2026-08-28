import {
  Activity,
  Copy,
  Flag,
  Home,
  LogIn,
  RefreshCw,
  UserRound,
} from "lucide-react";
import type { ErrorInfo, ReactNode } from "react";
import { Component, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthIdentity, getAuthSession } from "@/lib/auth";
import { getPublicWorkspaceTitle } from "@/lib/branding";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: unknown;
  errorInfo?: ErrorInfo;
  traceId: string;
};

function createTraceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown application error";
}

function isApiErrorLike(error: unknown): error is {
  name: "ApiError";
  status: number;
  requestId?: string;
  traceId?: string;
} {
  return (
    error instanceof Error &&
    error.name === "ApiError" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function diagnosticsFor(
  error: unknown,
  traceId: string,
  componentStack?: string,
): string {
  const location =
    typeof window === "undefined" ? "unknown" : window.location.href;
  const errorStack = error instanceof Error ? error.stack : undefined;
  const apiError = isApiErrorLike(error) ? error : undefined;

  return [
    `Trace ID: ${apiError?.traceId ?? traceId}`,
    apiError?.requestId ? `Request ID: ${apiError.requestId}` : "",
    `Location: ${location}`,
    `Time: ${new Date().toISOString()}`,
    `Error: ${errorMessage(error)}`,
    errorStack ? `Stack:\n${errorStack}` : "",
    componentStack ? `Component stack:${componentStack}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    traceId: createTraceId(),
  };

  static getDerivedStateFromError(error: unknown) {
    return { error, traceId: createTraceId() };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
  }

  private retry = () => {
    this.setState({ error: null, errorInfo: undefined });
  };

  render() {
    if (this.state.error === null) return this.props.children;

    return (
      <AppErrorPage
        error={this.state.error}
        traceId={this.state.traceId}
        componentStack={this.state.errorInfo?.componentStack ?? undefined}
        onRetry={this.retry}
      />
    );
  }
}

export function AppErrorPage({
  error,
  onRetry,
  traceId,
  componentStack,
}: {
  error: unknown;
  onRetry?: () => void;
  traceId?: string;
  componentStack?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [reportState, setReportState] = useState<"idle" | "unavailable">(
    "idle",
  );
  const [fallbackTraceId] = useState(createTraceId);
  const authenticated = Boolean(getAuthSession());
  const identity = getAuthIdentity();
  const apiFailure = isApiErrorLike(error);
  const stableTraceId = apiFailure
    ? (error.traceId ?? traceId ?? fallbackTraceId)
    : (traceId ?? fallbackTraceId);
  const diagnostics = diagnosticsFor(error, stableTraceId, componentStack);
  const destination = authenticated ? "/" : "/login";

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function reportIssue() {
    // TODO: send the diagnostic payload to the future issue-report endpoint.
    setReportState("unavailable");
  }

  return (
    <main className="min-h-svh bg-muted/30 px-4 py-6 sm:px-6 sm:py-8">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-xl border bg-background px-4 py-3 shadow-sm sm:px-5">
        <a href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="size-4" aria-hidden="true" />
          </span>
          {getPublicWorkspaceTitle()}
        </a>
        {authenticated ? (
          <a
            href="/profile"
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <UserRound className="size-4 shrink-0" aria-hidden="true" />
            <span className="max-w-48 truncate">
              {identity.displayName ?? identity.email ?? "Account"}
            </span>
          </a>
        ) : (
          <Button variant="outline" size="sm" asChild>
            <a href="/login">
              <LogIn data-icon="inline-start" />
              Sign in
            </a>
          </Button>
        )}
      </header>

      <div className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-2xl items-center justify-center py-12">
        <Card className="w-full overflow-hidden shadow-sm">
          <CardHeader className="items-center px-6 pt-10 text-center sm:px-10">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <RefreshCw className="size-8" aria-hidden="true" />
            </div>
            <p className="pt-2 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {apiFailure ? "API error" : "Application error"}
            </p>
            <CardTitle className="text-3xl tracking-tight sm:text-4xl">
              {apiFailure
                ? "The request could not be completed"
                : "This page could not render"}
            </CardTitle>
            <p className="max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
              {apiFailure
                ? "The API returned an error while loading this page. Try again or return to a safe starting point."
                : "The interface encountered an unexpected problem. This does not necessarily indicate an API or server failure."}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-6 pb-10 sm:px-10">
            <div className="rounded-lg border bg-muted/30 p-3 text-left text-sm">
              <p className="font-medium">Trace ID</p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {stableTraceId}
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => void copyDiagnostics()}>
                <Copy data-icon="inline-start" />
                {copyState === "copied" ? "Trace copied" : "Copy trace"}
              </Button>
              <Button type="button" variant="outline" onClick={reportIssue}>
                <Flag data-icon="inline-start" />
                Report issue
              </Button>
              {onRetry ? (
                <Button type="button" variant="outline" onClick={onRetry}>
                  <RefreshCw data-icon="inline-start" />
                  Try again
                </Button>
              ) : null}
              <Button variant="ghost" asChild>
                <a href={destination}>
                  <Home data-icon="inline-start" />
                  {authenticated ? "Home" : "Sign in"}
                </a>
              </Button>
            </div>

            {copyState === "failed" ? (
              <p className="text-center text-xs text-destructive">
                The trace could not be copied. Please copy the Trace ID above.
              </p>
            ) : null}
            {reportState === "unavailable" ? (
              <p className="text-center text-xs text-muted-foreground">
                Issue reporting is not connected yet. Copy the trace and share
                it with support.
              </p>
            ) : null}

            <details className="rounded-lg border px-3 py-2 text-left text-sm">
              <summary className="cursor-pointer font-medium">
                Technical details
              </summary>
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {diagnostics}
              </pre>
            </details>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
