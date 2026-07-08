import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "@/lib/settings";
import "./index.css";

// SettingsProvider owns theme application now (system/light/dark, live).

// No StrictMode: it double-invokes effects, which would spawn/kill the stateful
// Pi subprocess twice on mount and interrupt in-flight turns.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <SettingsProvider>
    <App />
  </SettingsProvider>,
);
