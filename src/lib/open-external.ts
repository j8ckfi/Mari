// Open a URL in the user's real browser, never inside the app webview.
//
// Clicking a bare <a> in a Tauri webview navigates the webview itself —
// replacing the whole app with the linked page. So every externally-bound link
// (chiefly links the agent emits in markdown) must route through here: in the
// desktop build we shell out via the opener plugin; in the browser dev build we
// fall back to a new tab.

import { isTauri } from "@/lib/agent/transport";

/** Matches links that should escape to the native browser / default handler. */
export function isExternalUrl(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // Opener unavailable/denied — fall through to a new tab rather than
      // silently swallowing the click.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
