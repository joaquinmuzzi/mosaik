/** The dashboard only reads data through the hub's API, never from the database. */
import type {
  AnkiStatsResponse,
  ContentDetailResponse,
  ContentsResponse,
  DayDetailResponse,
  HealthResponse,
  OverviewResponse,
  SearchResponse,
  SteamCandidate,
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
export const getContents = () => request<ContentsResponse>("/api/contents");
export const getContent = (id: string) =>
  request<ContentDetailResponse>(`/api/contents/${encodeURIComponent(id)}`);
export const search = (query: string, limit = 100) =>
  request<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
export const syncSource = (source: string) =>
  request<SyncOutcome>(`/api/sync/${encodeURIComponent(source)}`, { method: "POST" });

export const searchSteamCovers = (query: string) =>
  request<{ results: SteamCandidate[] }>(`/api/covers/steam?q=${encodeURIComponent(query)}`);
export const setSteamCover = (id: string, appId: number) =>
  request<{ ok: true }>(`/api/contents/${encodeURIComponent(id)}/cover/steam`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId }),
  });
export const uploadCover = (id: string, file: File) =>
  request<{ ok: true }>(`/api/contents/${encodeURIComponent(id)}/cover`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/png" },
    body: file,
  });
export const removeCover = (id: string) =>
  request<{ removed: boolean }>(`/api/contents/${encodeURIComponent(id)}/cover`, { method: "DELETE" });
