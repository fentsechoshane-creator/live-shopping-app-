import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { SessionProvider } from "./session";
import "./styles.css";

// The shareable phone preview (npm run build:artifact) runs inside a frame where the address bar is not ours,
// so it keeps routes in memory instead.
const Router = import.meta.env.VITE_ROUTER === "memory" ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </Router>
  </StrictMode>,
);
