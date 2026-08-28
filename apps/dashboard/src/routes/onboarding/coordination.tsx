import { CoordinationMode } from "@encois/contracts/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Bot, Check, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOrganization, updateOrganizationOnboarding } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding/coordination")({
  component: CoordinationSetupPage,
});

function CoordinationSetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const organization = useQuery({
    queryKey: queryKeys.organization(),
    queryFn: getOrganization,
  });
  const save = useMutation({
    mutationFn: () =>
      updateOrganizationOnboarding({
        coordinationMode: CoordinationMode.StartCoordinator,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organization(),
      });
      await navigate({ to: "/onboarding/workflows" });
    },
  });

  if (organization.isLoading)
    return (
      <p className="text-sm text-muted-foreground">
        Loading workspace initialization…
      </p>
    );
  if (organization.isError || !organization.data)
    return (
      <p
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        role="alert"
      >
        {organization.error?.message ?? "The workspace could not be loaded."}
      </p>
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Choose how to initialize your workspace
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your first <ProductTerm term="coordinator" /> run will use the
            source and workflow references selected for this organization.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <ModeCard
            selected
            icon={Sparkles}
            title={
              <>
                Start the first <ProductTerm term="coordinator" /> run
              </>
            }
            description="Required. The dashboard opens only after this bootstrap reports readiness."
          />
        </div>
        {save.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {save.error.message}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Review workflows"}{" "}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" aria-hidden="true" />{" "}
            <ProductTerm term="coordinator" /> bootstrap
          </CardTitle>
          <CardDescription>
            The selected mode is saved to the organization onboarding record.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[
            "Read the selected organization context",
            "Check available integration capabilities",
            "Propose standard workflows for review",
          ].map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-md border px-3 py-3 text-sm"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                <Check
                  className="size-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
              {item}
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            External systems are not changed by this setup.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ModeCard({
  selected,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean;
  icon: typeof Sparkles;
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-4 rounded-lg border bg-accent p-4 text-left",
        selected && "border-primary",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground">
        <Check className="size-3" aria-hidden="true" />
      </span>
    </div>
  );
}
