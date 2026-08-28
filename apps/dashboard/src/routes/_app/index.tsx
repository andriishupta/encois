import {
  Permission,
  type WorkflowRecentActivityProjection,
} from "@encois/contracts/browser";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CircleDashed,
  Mail,
  MessageCircle,
  Mic,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import {
  AvailabilityBadge,
  AvailabilityCard,
} from "@/components/availability-state";
import { EmptyPanel } from "@/components/empty-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAccountSummary } from "@/lib/account";
import { listWorkflowActivity } from "@/lib/api";
import { formatDate, humanizeKey } from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { organizationName, members } = useOrganization();
  const { can } = usePermissions();
  const account = getAccountSummary(members);
  const canViewWorkflows = can(Permission.WorkflowsRead);
  const activity = useQuery({
    queryKey: queryKeys.workflowActivity(),
    queryFn: listWorkflowActivity,
    enabled: canViewWorkflows,
  });
  const greetingName = account.name === "Account" ? "there" : account.name;
  const workspaceLabel = organizationName ?? "your workspace";

  return (
    <div data-testid="dashboard-page" className="flex flex-col gap-8">
      <PageHeader
        title={`Good morning, ${greetingName}`}
        description={`Pel AI, your workspace assistant for ${workspaceLabel}. Start with the latest context, then ask for more when you need it.`}
        actions={
          canViewWorkflows ? (
            <Button asChild>
              <Link data-testid="dashboard-run-workflow" to="/workflows">
                <Play data-icon="inline-start" />
                Run workflow
              </Link>
            </Button>
          ) : null
        }
      />

      <AssistantBriefing workspaceLabel={workspaceLabel} />

      <AvailabilityCard>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <CardTitle>Ask Pel AI</CardTitle>
                <CardDescription>
                  Ask what changed, what matters, or what happened last week.
                </CardDescription>
              </div>
            </div>
            <AvailabilityBadge />
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            aria-label="Pel AI coming soon"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background/70 px-3">
              <MessageCircle
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                disabled
                placeholder="Ask Pel AI about your workspace…"
                aria-label="Ask Pel AI"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled
                title="Pel AI voice coming soon"
                aria-label="Use Pel AI voice"
              >
                <Mic className="size-4" />
              </Button>
            </div>
            <Button type="submit" disabled>
              <Send data-icon="inline-start" />
              Ask
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Text chat and voice conversations will use the same scoped workspace
            context.
          </p>
        </CardContent>
      </AvailabilityCard>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <RecentContext
          activity={activity}
          canViewWorkflows={canViewWorkflows}
        />
        <SuggestedActions />
      </div>
    </div>
  );
}

type ActivityQuery = UseQueryResult<
  readonly WorkflowRecentActivityProjection[]
>;

function AssistantBriefing({ workspaceLabel }: { workspaceLabel: string }) {
  return (
    <AvailabilityCard className="overflow-hidden">
      <div className="border-b px-6 py-6 sm:px-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">Your morning brief</p>
              <AvailabilityBadge />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              A personalized brief for {workspaceLabel} will appear here when
              Pel AI is connected.
            </p>
          </div>
        </div>
      </div>
      <CardContent className="p-6 sm:p-8">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Preview examples — not live workspace data
        </p>
        <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
            <span>
              Michael wrote you about a GitHub issue that may need your input.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
            <span>
              The Checkout deploy failed and Pel AI is preparing context.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
            <span>
              Two source updates are available for your next morning brief.
            </span>
          </li>
        </ul>
      </CardContent>
    </AvailabilityCard>
  );
}

function RecentContext({
  activity,
  canViewWorkflows,
}: {
  activity: ActivityQuery;
  canViewWorkflows: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>What changed recently</CardTitle>
            <CardDescription>
              Real workflow events visible in your current scope.
            </CardDescription>
          </div>
          {canViewWorkflows ? (
            <Link
              to="/activity"
              aria-label="View all activity"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!canViewWorkflows ? (
          <EmptyPanel
            icon={CircleDashed}
            title="Workflow context is restricted"
            description="Ask an organization administrator for workflow access."
          />
        ) : null}
        {canViewWorkflows && activity.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading recent context…
          </p>
        ) : null}
        {canViewWorkflows && activity.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load recent context: {activity.error.message}
          </p>
        ) : null}
        {canViewWorkflows &&
        !activity.isLoading &&
        !activity.isError &&
        !activity.data?.length ? (
          <EmptyPanel
            icon={CircleDashed}
            title="No recent context"
            description="Workflow events will appear here when the API reports them."
          />
        ) : null}
        {canViewWorkflows
          ? activity.data
              ?.slice(0, 5)
              .map((event) => <ContextRow key={event.id} event={event} />)
          : null}
      </CardContent>
    </Card>
  );
}

function ContextRow({ event }: { event: WorkflowRecentActivityProjection }) {
  const issue =
    typeof event.metadata.issue === "string"
      ? ` · ${event.metadata.issue}`
      : "";
  const eventLabel = event.activityName || humanizeKey(event.eventType);
  return (
    <Link
      to="/workflows/$workflowId"
      params={{ workflowId: event.workflowId }}
      className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Activity className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {event.workflowLabel}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {eventLabel} · {event.status}
          {issue}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {formatDate(event.occurredAt)}
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

function SuggestedActions() {
  return (
    <AvailabilityCard>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Suggested actions</CardTitle>
            <CardDescription>
              Pel AI capabilities planned for this space.
            </CardDescription>
          </div>
          <AvailabilityBadge />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ComingSoonAction icon={CalendarClock} title="Compare with last week" />
        <ComingSoonAction icon={Mail} title="Connect your work email" />
        <ComingSoonAction icon={Mic} title="Talk to Pel AI" />
      </CardContent>
    </AvailabilityCard>
  );
}

function ComingSoonAction({
  icon: Icon,
  title,
}: {
  icon: typeof CalendarClock;
  title: string;
}) {
  return (
    <div
      aria-disabled="true"
      title="Coming Soon"
      className="flex cursor-help items-center gap-3 rounded-lg border border-dashed p-3 text-muted-foreground"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      <AvailabilityBadge />
    </div>
  );
}
