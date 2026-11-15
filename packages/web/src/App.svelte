<script lang="ts">
  /** The dashboard: a quiet sidebar and the pages, on a neutral graphite ramp. */
  import type { HealthResponse } from "@mosaik/shared";
  import { onMount } from "svelte";
  import { getHealth } from "./lib/api";
  import { router } from "./lib/router.svelte";
  import Content from "./pages/Content.svelte";
  import Day from "./pages/Day.svelte";
  import Search from "./pages/Search.svelte";
  import Sources from "./pages/Sources.svelte";
  import Stats from "./pages/Stats.svelte";
  import Anki from "./pages/Anki.svelte";
  import Contents from "./pages/Contents.svelte";
  import Home from "./pages/Home.svelte";

  let health = $state<HealthResponse | null>(null);
  onMount(() => {
    const check = () =>
      getHealth()
        .then((result) => (health = result))
        .catch(() => (health = null));
    void check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  });

  const links = [
    { href: "#/", page: "home", label: "Panel", icon: "M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z" },
    {
      href: "#/contenido",
      page: "contents",
      label: "Biblioteca",
      icon: "M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 14-4-1z",
    },
    { href: "#/anki", page: "anki", label: "Anki", icon: "M5 4h11l3 3v13H5zM8 10h8M8 14h8M8 18h5" },
    {
      href: "#/estadisticas",
      page: "stats",
      label: "Estadísticas",
      icon: "M4 20h16M6 20v-7M11 20V5M16 20v-10",
    },
    {
      href: "#/buscar",
      page: "search",
      label: "Buscar",
      icon: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20",
    },
    {
      href: "#/fuentes",
      page: "sources",
      label: "Fuentes",
      icon: "M12 3v6M12 15v6M3 12h6M15 12h6M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
    },
  ] as const;

  const active = (page: string) =>
    router.route.page === page || (page === "contents" && router.route.page === "content");
</script>

<div class="k-layout">
  <aside class="k-side">
    <div class="k-side-inner">
      <a class="k-brand" href="#/">
        <span class="k-tiles" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        Mosaik
      </a>
      <nav aria-label="Secciones">
        {#each links as link (link.href)}
          <a href={link.href} aria-label={link.label} aria-current={active(link.page) ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={link.icon} /></svg>
            <span>{link.label}</span>
          </a>
        {/each}
      </nav>
      <p class="k-status" class:down={!health}>
        <span class="tile" aria-hidden="true"></span>{health ? "Hub conectado" : "Hub sin conexión"}
      </p>
    </div>
  </aside>

  <main class="k-main">
    {#if router.route.page === "home"}
      <Home />
    {:else if router.route.page === "contents"}
      <Contents />
    {:else if router.route.page === "anki"}
      <Anki />
    {:else if router.route.page === "stats"}
      <Stats />
    {:else if router.route.page === "content"}
      <Content id={router.route.id} />
    {:else if router.route.page === "day"}
      <Day day={router.route.day} />
    {:else if router.route.page === "search"}
      <Search query={router.route.query} />
    {:else}
      <Sources />
    {/if}
  </main>
</div>

<style>
  .k-layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    min-height: 100vh;
  }

  .k-side {
    background: var(--sidebar);
    border-right: 1px solid var(--border);
  }

  .k-side-inner {
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 20px 12px;
    box-sizing: border-box;
  }

  .k-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 8px;
    color: var(--text);
    font-size: 1.1429rem;
    font-weight: 500;
    text-decoration: none;
  }

  .k-tiles {
    display: grid;
    grid-template-columns: repeat(2, 8px);
    gap: 2px;
  }

  .k-tiles i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--series-gsm);
  }

  .k-tiles i:nth-child(2) {
    background: var(--series-youtube);
  }

  .k-tiles i:nth-child(3) {
    background: var(--series-refold);
  }

  .k-tiles i:nth-child(4) {
    background: var(--accent);
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  nav a {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    color: var(--secondary);
    text-decoration: none;
    transition:
      background-color 150ms var(--ease),
      color 150ms var(--ease);
  }

  nav a:hover {
    background: var(--surface);
    color: var(--text);
  }

  /* The active row: one surface step, a hairline and a soft top highlight */
  nav a[aria-current="page"] {
    background: var(--surface-2);
    border-color: var(--border);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06);
    color: var(--text);
  }

  nav svg {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .k-status {
    margin: auto 0 0;
    padding: 0 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 0.8571rem;
  }

  .k-status .tile {
    background: var(--positive);
  }

  .k-status.down .tile {
    background: var(--danger);
  }

  .k-main {
    width: 100%;
    max-width: 1440px;
    padding: 32px 32px 80px;
    box-sizing: border-box;
    /* A wide table scrolls inside its card instead of widening the page */
    min-width: 0;
  }

  @media (max-width: 1000px) {
    .k-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .k-side {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .k-side-inner {
      position: static;
      height: auto;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
    }

    nav {
      flex-direction: row;
      flex-wrap: wrap;
    }

    nav span {
      display: none;
    }

    .k-status {
      margin: 0 0 0 auto;
    }

    .k-main {
      padding: 20px 16px 80px;
    }
  }
</style>
