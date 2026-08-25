import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/memory/sources")({
  component: SourcesLayout,
});

function SourcesLayout() {
  return <Outlet />;
}
