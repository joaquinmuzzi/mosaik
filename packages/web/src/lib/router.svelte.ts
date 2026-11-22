/**
 * A hash router: `#/`, `#/dia/2026-11-14`, `#/anki`, `#/contenido`, `#/contenido?tipo=juegos`,
 * `#/contenido/<id>`,
 * `#/buscar?q=…`, `#/estadisticas`, `#/fuentes`. Works from any static server.
 */

/** What the library shows: everything, or one kind of content. */
export type ContentFilter = "all" | "game" | "video";

const FILTERS: Record<string, ContentFilter> = { juegos: "game", videos: "video" };

export type Route =
  | { page: "home" }
  | { page: "day"; day: string }
  | { page: "anki" }
  | { page: "stats" }
  | { page: "contents"; kind: ContentFilter }
  | { page: "content"; id: string }
  | { page: "search"; query: string }
  | { page: "sources" };

function parse(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#/, "").split("?");
  const day = /^\/dia\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (day) return { page: "day", day: day[1]! };
  const content = /^\/contenido\/(.+)$/.exec(path);
  if (content) return { page: "content", id: decodeURIComponent(content[1]!) };
  if (path === "/contenido") {
    return { page: "contents", kind: FILTERS[new URLSearchParams(search).get("tipo") ?? ""] ?? "all" };
  }
  if (path === "/buscar") return { page: "search", query: new URLSearchParams(search).get("q") ?? "" };
  if (path === "/anki") return { page: "anki" };
  if (path === "/estadisticas") return { page: "stats" };
  if (path === "/fuentes") return { page: "sources" };
  return { page: "home" };
}

export const router = $state<{ route: Route }>({ route: parse(location.hash) });

window.addEventListener("hashchange", () => {
  const next = parse(location.hash);
  // Typing in the search box changes the hash; that should not jump to the top
  if (!(next.page === "search" && router.route.page === "search")) window.scrollTo(0, 0);
  router.route = next;
});

export * from "./hrefs";
