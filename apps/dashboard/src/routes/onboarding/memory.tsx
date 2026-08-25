import { KnowledgeSourceKind } from "@encois/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  FileText,
  Github,
  LoaderCircle,
  MessageSquare,
  PlugZap,
  Upload,
  Workflow,
} from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  isApiError,
  listKnowledgeSources,
  startSourceIngestion,
  uploadKnowledgeSourcePdf,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding/memory")({
  component: MemorySetupPage,
});

const integrationSources: {
  id: string;
  label: string;
  description: string;
  icon: typeof Github;
}[] = [
  {
    id: "slack",
    label: "Slack",
    description: "Team updates and decisions",
    icon: MessageSquare,
  },
  {
    id: "github",
    label: "GitHub",
    description: "Repositories and delivery activity",
    icon: Github,
  },
  {
    id: "jira",
    label: "Jira",
    description: "Projects, issues, and releases",
    icon: Workflow,
  },
  {
    id: "linear",
    label: "Linear",
    description: "Issues and project cycles",
    icon: PlugZap,
  },
];

function MemorySetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sources = useQuery({
    queryKey: queryKeys.sources(),
    queryFn: listKnowledgeSources,
  });
  const [file, setFile] = useState<File | undefined>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existingSource = sources.data?.find(
    (source) => source.kind === KnowledgeSourceKind.UploadedDocument,
  );

  function handleDocument(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    setFile(nextFile);
    setError(null);
  }

  async function handleContinue() {
    if (!file && !existingSource) {
      setError(
        "Upload at least one PDF to continue. This step cannot be skipped.",
      );
      return;
    }
    setUploading(true);
    setError(null);
    try {
      if (file) {
        const uploaded = await uploadKnowledgeSourcePdf(file, file.name);
        await startSourceIngestion(uploaded.source.id, uploaded.revision.id);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.sourcesRoot(),
        });
      }
      await navigate({ to: "/onboarding/coordination" });
    } catch (cause) {
      setError(
        isApiError(cause) ? cause.message : "The source could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  }

  const sourceLabel = file?.name ?? existingSource?.name;
  const canContinue =
    Boolean(file || existingSource) && !uploading && !sources.isLoading;

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Give your <ProductTerm term="coordinator" /> some memory
        </h1>
        <p className="mt-2 text-muted-foreground">
          Upload at least one organization graph document. The workspace stores
          it as a scoped source and starts the common ingestion workflow.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source types</CardTitle>
          <CardDescription>
            Provider connectors use the same{" "}
            <ProductTerm term="knowledgeSource" /> boundary and can be connected
            after the first source is uploaded.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {integrationSources.map((source) => {
            const Icon = source.icon;
            return (
              <div
                key={source.id}
                className="flex items-start gap-3 rounded-lg border p-4 opacity-60"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {source.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {source.description} · Connect after setup
                  </span>
                </span>
                <Check
                  className="mt-1 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload organization context</CardTitle>
          <CardDescription>
            PDF upload is available now. The file becomes a scoped source{" "}
            <ProductTerm term="revision" /> and starts the common{" "}
            <ProductTerm term="ingestion" /> <ProductTerm term="workflow" />.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors hover:bg-accent",
              sourceLabel && "border-primary bg-accent",
            )}
            htmlFor="onboarding-source-file"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <FileText
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <span className="text-sm font-medium">
              {sourceLabel ?? "Choose an organization context PDF"}
            </span>
            <span className="text-xs text-muted-foreground">
              PDF only · maximum 10 MiB
            </span>
            <span className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium">
              <Upload className="size-3.5" aria-hidden="true" /> Choose file
            </span>
            <input
              id="onboarding-source-file"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={handleDocument}
            />
          </label>
          {existingSource && !file ? (
            <p className="mt-3 text-xs text-muted-foreground">
              An uploaded source already exists in this organization. Choose
              another PDF to add a new revision.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {sources.isError ? (
        <p className="text-sm text-muted-foreground">
          Existing sources could not be listed. You can still upload a new PDF.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">
          {sourceLabel
            ? `Selected: ${sourceLabel}`
            : "Select a PDF source to continue."}
        </p>
        <Button
          type="button"
          disabled={!canContinue}
          onClick={() => void handleContinue()}
        >
          {uploading ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : null}
          {uploading ? "Uploading source…" : "Continue"}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}
