import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export async function invalidateWorkflowExecutionQueries(
  queryClient: QueryClient,
  workflowId?: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.workflowRunListRoot(),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workflowActivity() }),
    ...(workflowId
      ? [
          queryClient.invalidateQueries({
            queryKey: queryKeys.workflow(workflowId),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.workflowEvents(workflowId),
          }),
        ]
      : []),
  ]);
}

export async function invalidateWorkflowPlanQueries(
  queryClient: QueryClient,
  planId?: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.workflowPlansRoot() }),
    ...(planId
      ? [
          queryClient.invalidateQueries({
            queryKey: queryKeys.workflowPlan(planId),
          }),
        ]
      : []),
  ]);
}

export async function invalidateSourceQueries(
  queryClient: QueryClient,
  sourceId?: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcesRoot() }),
    ...(sourceId
      ? [
          queryClient.invalidateQueries({
            queryKey: queryKeys.source(sourceId),
          }),
        ]
      : []),
  ]);
}
