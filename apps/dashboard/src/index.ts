import "@xbond/client-ui/bootstrap";

async function registerDashboardWorker() {
  const registration = await navigator.serviceWorker.register("./sw.js");
  const offerUpdate = () => {
    if (
      !registration.waiting ||
      !navigator.serviceWorker.controller ||
      document.getElementById("xbond-update")
    )
      return;
    const button = document.createElement("button");
    button.id = "xbond-update";
    button.className =
      "fixed end-4 bottom-4 z-50 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg";
    button.textContent = "Update dashboard";
    button.addEventListener(
      "click",
      () => {
        if (!registration.waiting) {
          location.reload();
          return;
        }
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => location.reload(),
          { once: true },
        );
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      },
      { once: true },
    );
    document.body.append(button);
  };
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", offerUpdate);
  });
  offerUpdate();
}

if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  location.protocol === "https:" &&
  !document.querySelector('meta[name="localapi-token"]')
) {
  void registerDashboardWorker().catch((error: unknown) =>
    console.warn("Dashboard service worker unavailable", error),
  );
}
