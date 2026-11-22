/** The addresses of the pages (see router.svelte.ts). */
export const hrefDay = (day: string) => `#/dia/${day}`;
export const hrefContent = (id: string) => `#/contenido/${encodeURIComponent(id)}`;
export const hrefContents = (kind: "juegos" | "videos") => `#/contenido?tipo=${kind}`;
export const hrefSearch = (query: string) => `#/buscar?q=${encodeURIComponent(query)}`;
