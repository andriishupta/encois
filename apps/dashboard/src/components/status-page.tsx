import { Link } from "@tanstack/react-router";
import {
  Activity,
  Home,
  LogIn,
  ServerCrash,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAuthIdentity, getAuthSession } from "@/lib/auth";
import { getPublicWorkspaceTitle } from "@/lib/branding";

type StatusCode = 403 | 404 | 500;

const statusContent: Record<
  StatusCode,
  { icon: typeof Home; label: string; title: string; description: string }
> = {
  403: {
    icon: ShieldAlert,
    label: "Access denied",
    title: "You do not have access to this page",
    description:
      "Your account is signed in, but this area requires a permission that is not available in the current scope.",
  },
  404: {
    icon: Home,
    label: "Page not found",
    title: "Not Found",
    description:
      "The page you are looking for does not exist or is no longer available.",
  },
  500: {
    icon: ServerCrash,
    label: "Server error",
    title: "Something went wrong",
    description:
      "The workspace could not complete this request. Please return to a safe starting point and try again later.",
  },
};

export function StatusPage({ code }: { code: StatusCode }) {
  const authenticated = Boolean(getAuthSession());
  const identity = getAuthIdentity();
  const content = statusContent[code];
  const Icon = content.icon;
  const destination = authenticated ? "/" : "/login";
  const actionLabel = authenticated ? "Home" : "Sign in";

  return (
    <main className="min-h-svh bg-muted/30 px-4 py-6 sm:px-6 sm:py-8">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-xl border bg-background px-4 py-3 shadow-sm sm:px-5">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="size-4" aria-hidden="true" />
          </span>
          {getPublicWorkspaceTitle()}
        </Link>
        {authenticated ? (
          <Link
            to="/profile"
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <UserRound className="size-4 shrink-0" aria-hidden="true" />
            <span className="max-w-48 truncate">
              {identity.displayName ?? identity.email ?? "Account"}
            </span>
          </Link>
        ) : (
          <Button variant="outline" size="sm" asChild>
            <Link to="/login">
              <LogIn data-icon="inline-start" />
              Sign in
            </Link>
          </Button>
        )}
      </header>

      <div className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-2xl items-center justify-center py-12">
        <Card className="w-full overflow-hidden shadow-sm">
          <CardContent className="flex flex-col items-center px-6 py-12 text-center sm:px-10 sm:py-16">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon className="size-8" aria-hidden="true" />
            </div>
            <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {code} · {content.label}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {content.title}
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
              {content.description}
            </p>
            <Button className="mt-8" asChild>
              <Link to={destination}>
                {authenticated ? (
                  <Home data-icon="inline-start" />
                ) : (
                  <LogIn data-icon="inline-start" />
                )}
                {actionLabel}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
