import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { initializeBrowserAuth } from "@/lib/auth";
import { router } from "@/router";
import "./index.css";

// 5 min
const staleTime = 5 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

async function bootstrap() {
  await initializeBrowserAuth();
  const root = document.getElementById("root");
  if (!root) throw new Error("Dashboard root element is missing.");
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
