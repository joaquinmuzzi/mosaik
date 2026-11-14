/** The dashboard only reads data through the hub's API, never from the database. */
import type {
  AnkiStatsResponse,
  DayDetailResponse,
  HealthResponse,
  OverviewResponse,
  SourcesResponse,
  SyncOutcome,
} from "@mosaik/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const getHealth = () => request<HealthResponse>("/api/health");
export const getSources = () => request<SourcesResponse>("/api/sources");
export const getOverview = (days = 30) => request<OverviewResponse>(`/api/overview?days=${days}`);
export const getDay = (day: string) => request<DayDetailResponse>(`/api/days/${day}`);
export const getAnki = () => request<AnkiStatsResponse>("/api/anki");
export const syncSource = (source: string) =>
  request<SyncOutcome>(`/api/sync/${encodeURIComponent(source)}`, { method: "POST" });
