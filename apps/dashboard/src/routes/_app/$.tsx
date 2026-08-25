import { createFileRoute } from "@tanstack/react-router";
import { NotFoundPanel } from "@/components/status-page";

export const Route = createFileRoute("/_app/$")({
  component: () => <NotFoundPanel />,
});
