import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
      retry: 1,
    },
  },
});

async function bootstrap() {
  await initializeBrowserAuth();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
