import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(
        registrations
          .filter((registration) =>
            [
              registration.active,
              registration.waiting,
              registration.installing,
            ].some((worker) => worker?.scriptURL.endsWith("/download-worker.js")),
          )
          .map((registration) => registration.unregister()),
      ),
    )
    .catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
