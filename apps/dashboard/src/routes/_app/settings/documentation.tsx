import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, CalendarDays } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getBranding } from "@/lib/branding";
import { useOrganization } from "@/lib/organization-context";
import documentationMarkdown from "../../../../../../docs/documentation.md?raw";

export const Route = createFileRoute("/_app/settings/documentation")({
  component: DocumentationPage,
});

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h2 className="border-b pb-4 text-2xl font-semibold tracking-tight sm:text-3xl">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 border-b pb-2 text-xl font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-7 text-lg font-semibold tracking-tight">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="leading-7 text-muted-foreground">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-4 list-disc space-y-2 pl-6 text-muted-foreground marker:text-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 list-decimal space-y-2 pl-6 text-muted-foreground marker:font-medium marker:text-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-5 border-l-2 pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-border" />,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-5 overflow-x-auto rounded-lg border bg-muted/30 p-4 text-xs leading-6">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[32rem] text-left text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="border-b px-4 py-3 font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b px-4 py-3 align-top leading-6 text-muted-foreground last:border-b-0">
      {children}
    </td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noreferrer" : undefined}
      className="font-medium text-primary underline underline-offset-4 hover:no-underline"
    >
      {children}
    </a>
  ),
};

function DocumentationPage() {
  const { organizationName } = useOrganization();
  const { productName, poweredByVisible } = getBranding(
    organizationName ?? undefined,
  );
  const renderedDocumentation = documentationMarkdown.replaceAll(
    "{{PRODUCT_NAME}}",
    productName,
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${productName} Documentation`}
        description={`A practical guide to the ${productName} workspace, workflows, organization context, integrations, and access.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {poweredByVisible ? (
              <span className="inline-flex items-center rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                Powered by {productName}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Last updated · 2026-08-23
            </span>
          </div>
        }
      />

      <Card>
        <CardContent className="px-6 py-8 sm:px-10 sm:py-10 lg:px-16">
          <div className="mb-8 flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            <BookOpen className="size-4 shrink-0" aria-hidden="true" />
            <span>
              Documentation is shared across all access levels. Available
              actions still depend on your organization permissions and selected
              scope.
            </span>
          </div>
          <article className="mx-auto max-w-4xl space-y-5">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {renderedDocumentation}
            </ReactMarkdown>
          </article>
        </CardContent>
      </Card>
    </div>
  );
}
