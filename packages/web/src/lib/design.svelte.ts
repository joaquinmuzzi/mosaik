/**
 * Which design (visual variant) the dashboard shows. Chosen with the picker or `?design=<id>` in the
 * address, and remembered in this browser. The variant sets `data-design` on <html>, which its
 * stylesheet uses for its colors; every variant reads the same API, so the numbers never change.
 */

export const DESIGNS = [
  { id: "actual", label: "Actual" },
  { id: "kechimochi", label: "Kechimochi" },
  { id: "minimal", label: "Minimal" },
  { id: "bento", label: "Bento" },
  { id: "spielstand", label: "Spielstand" },
] as const;

export type DesignId = (typeof DESIGNS)[number]["id"];

const KEY = "mosaik.design";
const isDesign = (value: unknown): value is DesignId => DESIGNS.some((design) => design.id === value);

function initial(): DesignId {
  const fromUrl = new URLSearchParams(location.search).get("design");
  if (isDesign(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(KEY);
    if (isDesign(stored)) return stored;
  } catch {
    // Storage can be blocked; the default is fine
  }
  return "actual";
}

export const design = $state<{ id: DesignId }>({ id: initial() });

function apply(id: DesignId) {
  document.documentElement.dataset.design = id;
  const url = new URL(location.href);
  url.searchParams.set("design", id);
  history.replaceState(history.state, "", url);
}

apply(design.id);

export function setDesign(id: DesignId) {
  design.id = id;
  apply(id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not remembered, but still applied
  }
}
