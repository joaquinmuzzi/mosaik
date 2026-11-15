/**
 * Whether the dashboard can read the API. In local mode always; in server mode only with a session,
 * which the login page starts. Any answer 401 from the API means the session ended.
 */
import type { AuthStatusResponse } from "@mosaik/shared";
import { onUnauthorized } from "./api";

export const auth = $state<{ status: AuthStatusResponse | null; checked: boolean }>({
  status: null,
  checked: false,
});

export async function refreshAuth(): Promise<void> {
  try {
    const response = await fetch("/api/auth/status");
    auth.status = response.ok ? ((await response.json()) as AuthStatusResponse) : null;
  } catch {
    auth.status = null;
  }
  auth.checked = true;
}

/** The API said 401: back to the login page (server mode only; local mode never answers 401). */
export function sessionEnded(): void {
  if (auth.status?.mode === "server") {
    auth.status = { ...auth.status, authenticated: false, username: null };
  }
}

onUnauthorized(sessionEnded);

export const isServer = () => auth.status?.mode === "server";
