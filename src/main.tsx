import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./ui/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support and instant reloads. Production only; the dev server must not be intercepted.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        // Offline support is progressive enhancement; the app works without it.
      });
  });
}
