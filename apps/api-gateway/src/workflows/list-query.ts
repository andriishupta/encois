export type ListSort = "updated-desc" | "updated-asc" | "name-asc" | "status";

export type ListQuery = {
  query?: string;
  status?: string;
  sort: ListSort;
  limit: number;
  offset: number;
};

export type ListPage<T> = {
  items: readonly T[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};

export type ListQueryParseResult =
  | { value: ListQuery }
  | { error: string };

export function parseListQuery(
  input: {
    query?: string;
    status?: string;
    sort?: string;
    limit?: string;
    offset?: string;
  },
  options: { maxLimit: number; statuses?: readonly string[] },
): ListQueryParseResult {
  const limit = parseInteger(input.limit, 1, options.maxLimit, Math.min(options.maxLimit, 25));
  if (limit === null) return { error: `limit must be an integer between 1 and ${options.maxLimit}.` };

  const offset = parseInteger(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  if (offset === null) return { error: "offset must be a non-negative integer." };

  const status = input.status?.trim().toLowerCase();
  if (status && status !== "all" && options.statuses && !options.statuses.includes(status)) {
    return { error: `status must be one of: ${options.statuses.join(", ")}.` };
  }

  const sort = input.sort?.trim().toLowerCase() || "updated-desc";
  if (!["updated-desc", "updated-asc", "name-asc", "status"].includes(sort)) {
    return { error: "sort must be one of: updated-desc, updated-asc, name-asc, status." };
  }

  return {
    value: {
      ...(input.query?.trim() ? { query: input.query.trim().slice(0, 160) } : {}),
      ...(status && status !== "all" ? { status } : {}),
      sort: sort as ListSort,
      limit,
      offset,
    },
  };
}

export function listPage<T>(items: readonly T[], query: ListQuery): ListPage<T> {
  const page = items.slice(query.offset, query.offset + query.limit);
  return {
    items: page,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + page.length < items.length,
    },
  };
}

function parseInteger(value: string | undefined, min: number, max: number, fallback: number): number | null {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}
