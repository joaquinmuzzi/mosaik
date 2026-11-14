/** The dashboard only reads data through the hub's API, never from the database. */
import type { HealthResponse, SourcesResponse, SyncOutcome } from "@mosaik/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const getHealth = () => request<HealthResponse>("/api/health");
export const getSources = () => request<SourcesResponse>("/api/sources");
export const syncSource = (source: string) =>
  request<SyncOutcome>(`/api/sync/${encodeURIComponent(source)}`, { method: "POST" });
