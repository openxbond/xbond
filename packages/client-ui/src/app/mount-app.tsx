import { Suspense, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";

import { Spinner } from "@/components/ui/spinner";
import { LatencyProvider } from "@/features/proxies/latency-context";

import App from "./app-shell";

import "@/styles/app.css";

export default function renderApp() {
  const rootEl = document.getElementById("root");
  const AppInstance = (
    <StrictMode>
      <HashRouter>
        <Suspense
          fallback={
            <div className="fixed inset-0 flex items-center justify-center bg-background">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          }
        >
          <LatencyProvider>
            <App />
          </LatencyProvider>
        </Suspense>
      </HashRouter>
    </StrictMode>
  );

  const root = createRoot(rootEl!);
  root.render(AppInstance);
}
