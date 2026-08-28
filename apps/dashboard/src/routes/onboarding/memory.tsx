import { KnowledgeSourceKind } from "@encois/contracts/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, FileText, LoaderCircle, Upload } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { InlineError } from "@/components/inline-error";
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
  startOrganizationOnboarding,
  startSourceIngestion,
  uploadKnowledgeSourcePdf,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding/memory")({
  component: MemorySetupPage,
});

function MemorySetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sources = useQuery({
    queryKey: queryKeys.sources(),
    queryFn: () => listKnowledgeSources(),
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

  async function handleSubmit() {
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
      await startOrganizationOnboarding();
      await navigate({ to: "/" });
    } catch (cause) {
      setError(
        isApiError(cause) ? cause.message : "The source could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  }

  const sourceLabel = file?.name ?? existingSource?.name;
  const canSubmit = !uploading && !sources.isLoading;

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Give your <ProductTerm term="coordinator" /> some memory
        </h1>
        <p className="mt-2 text-muted-foreground">
          Upload one organization graph document, or skip for now and add a
          source later from the workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload organization context</CardTitle>
          <CardDescription>
            PDF upload is available now. The file becomes a scoped source{" "}
            <ProductTerm term="revision" /> and starts the common{" "}
            <ProductTerm term="ingestion" /> <ProductTerm term="workflow" />.
            You can also skip this step and add a source later.
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
        <InlineError
          title="Existing Sources unavailable"
          message="You can still upload a new PDF, or try loading existing Sources again."
          onRetry={() => sources.refetch()}
          retrying={sources.isFetching}
        />
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
            : "No document selected. You can skip for now."}
        </p>
        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          {uploading ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : null}
          {uploading
            ? "Starting setup…"
            : sourceLabel
              ? "Start setup"
              : "Skip for now"}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}
