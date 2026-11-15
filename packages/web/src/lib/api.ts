/** The dashboard only reads data through the hub's API, never from the database. */
import type {
  AnkiStatsResponse,
  ContentDetailResponse,
  ContentsResponse,
  CreateDeviceResponse,
  DayDetailResponse,
  DevicesResponse,
  HealthResponse,
  OverviewResponse,
  SearchResponse,
  SteamCandidate,
  SourcesResponse,
  StatsResponse,
  SyncOutcome,
} from "@mosaik/shared";

/** Called when the API answers 401 (a session that ended); the login state subscribes to it. */
let unauthorized: () => void = () => {};
export function onUnauthorized(callback: () => void): void {
  unauthorized = callback;
}

/** An answer that was not OK, with the error code the hub sent (`invalid_credentials`, …). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: Record<string, unknown>;

  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = typeof body.error === "string" ? body.error : null;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    // A session that ended (server mode): back to the login page
    if (response.status === 401 && !path.startsWith("/api/auth/")) unauthorized();
    throw new ApiError(`${init?.method ?? "GET"} ${path}: HTTP ${response.status}`, response.status, body);
  }
  return (await response.json()) as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

export const setupAccount = (token: string, username: string, password: string) =>
  send<{ ok: true }>("POST", "/api/auth/setup", { token, username, password });
export const login = (username: string, password: string) =>
  send<{ ok: true }>("POST", "/api/auth/login", { username, password });
export const logout = () => send<{ ok: true }>("POST", "/api/auth/logout");
export const getDevices = () => request<DevicesResponse>("/api/devices");
export const createDevice = (name: string) => send<CreateDeviceResponse>("POST", "/api/devices", { name });
export const revokeDevice = (name: string) =>
  send<{ revoked: boolean }>("DELETE", `/api/devices/${encodeURIComponent(name)}`);

export const getHealth = () => request<HealthResponse>("/api/health");
export const getSources = () => request<SourcesResponse>("/api/sources");
export const getOverview = (days = 30) => request<OverviewResponse>(`/api/overview?days=${days}`);
export const getDay = (day: string) => request<DayDetailResponse>(`/api/days/${day}`);
export const getAnki = () => request<AnkiStatsResponse>("/api/anki");
export const getStats = () => request<StatsResponse>("/api/stats");
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
