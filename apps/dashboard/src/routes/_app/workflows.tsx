import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/workflows")({
  component: () => <Outlet />,
});
