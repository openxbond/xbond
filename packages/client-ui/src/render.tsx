import { Loading } from "@components";
import App from "@containers/App";
import { LatencyProvider } from "@stores";
import { Suspense, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";

import "@unocss/reset/tailwind.css";
import "uno.css";

export default function renderApp() {
  const rootEl = document.getElementById("root");
  const AppInstance = (
    <StrictMode>
      <HashRouter>
        <Suspense fallback={<Loading visible />}>
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
