/** A hash router: `#/`, `#/dia/2026-11-14`, `#/anki`, `#/fuentes`. Works from any static server. */

export type Route = { page: "home" } | { page: "day"; day: string } | { page: "anki" } | { page: "sources" };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, "");
  const day = /^\/dia\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (day) return { page: "day", day: day[1]! };
  if (path === "/anki") return { page: "anki" };
  if (path === "/fuentes") return { page: "sources" };
  return { page: "home" };
}

export const router = $state<{ route: Route }>({ route: parse(location.hash) });

window.addEventListener("hashchange", () => {
  router.route = parse(location.hash);
  window.scrollTo(0, 0);
});

export const hrefDay = (day: string) => `#/dia/${day}`;
