import { Grid2X2, List as ListIcon, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ListViewMode = "grid" | "list";

export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {children}
      </CardContent>
    </Card>
  );
}

export function ListSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 pl-3 pr-3"
      />
    </div>
  );
}

export function ListFilter({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  label: string;
}) {
  return (
    <div className="flex min-w-36 items-center gap-2">
      <span className="sr-only">{label}</span>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={options}
        aria-label={label}
      />
    </div>
  );
}

export function ListMeta({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs text-muted-foreground sm:ml-auto">{children}</span>
  );
}

export function ListSummary({
  items,
}: {
  items: readonly { label: string; value: string; detail: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="flex flex-col gap-1 px-4 py-4">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-xl font-semibold tracking-tight">{item.value}</p>
            <p className="text-[11px] text-muted-foreground">{item.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ListViewToggle({
  value,
  onChange,
}: {
  value: ListViewMode;
  onChange: (value: ListViewMode) => void;
}) {
  return (
    <fieldset
      className="m-0 flex shrink-0 items-center rounded-md border p-0.5"
      aria-label="Change list view"
    >
      <Button
        type="button"
        variant={value === "grid" ? "secondary" : "ghost"}
        size="icon"
        aria-label="Grid view"
        aria-pressed={value === "grid"}
        onClick={() => onChange("grid")}
      >
        <Grid2X2 data-icon="inline-start" />
      </Button>
      <Button
        type="button"
        variant={value === "list" ? "secondary" : "ghost"}
        size="icon"
        aria-label="List view"
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
      >
        <ListIcon data-icon="inline-start" />
      </Button>
    </fieldset>
  );
}

export function ListCollection<T>({
  items,
  view,
  getKey,
  renderItem,
}: {
  items: readonly T[];
  view: ListViewMode;
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <div
      className={cn(
        "gap-4",
        view === "grid" ? "grid md:grid-cols-2" : "flex flex-col",
      )}
    >
      {items.map((item) => (
        <div key={getKey(item)} className="min-w-0">
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}

export function ListPagination({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  if (!hasMore)
    return (
      <p className="py-2 text-center text-xs text-muted-foreground">
        No more results
      </p>
    );
  return (
    <div className="flex justify-center py-2">
      <Button
        type="button"
        variant="outline"
        onClick={onLoadMore}
        disabled={loading}
      >
        {loading ? (
          <>
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
            Loading…
          </>
        ) : (
          "Load more"
        )}
      </Button>
    </div>
  );
}
