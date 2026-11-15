<script lang="ts">
  /** Bento: a slim top bar with pill navigation, and grids of blocks below. */
  import "./theme.css";
  import { router } from "../../lib/router.svelte";
  import Content from "../../pages/Content.svelte";
  import Day from "../../pages/Day.svelte";
  import Search from "../../pages/Search.svelte";
  import Sources from "../../pages/Sources.svelte";
  import Anki from "./Anki.svelte";
  import Contents from "./Contents.svelte";
  import Home from "./Home.svelte";

  const links = [
    { href: "#/", page: "home", label: "Hoy" },
    { href: "#/contenido", page: "contents", label: "Contenido" },
    { href: "#/anki", page: "anki", label: "Anki" },
    { href: "#/buscar", page: "search", label: "Buscar" },
    { href: "#/fuentes", page: "sources", label: "Fuentes" },
  ] as const;
  const active = (page: string) =>
    router.route.page === page || (page === "contents" && router.route.page === "content");
</script>

<header class="b-top">
  <a class="b-logo" href="#/"><span aria-hidden="true">▦</span> Mosaik</a>
  <nav aria-label="Secciones">
    {#each links as link (link.href)}
      <a href={link.href} aria-current={active(link.page) ? "page" : undefined}>{link.label}</a>
    {/each}
  </nav>
</header>

<main class="b-main">
  {#if router.route.page === "home"}
    <Home />
  {:else if router.route.page === "contents"}
    <Contents />
  {:else if router.route.page === "anki"}
    <Anki />
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

<style>
  .b-top {
    max-width: 1180px;
    margin: 0 auto;
    padding: 18px 20px 6px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .b-logo {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-size: 1.125rem;
    font-weight: 700;
    text-decoration: none;
  }

  .b-logo span {
    color: var(--accent);
    font-size: 1.25rem;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  nav a {
    padding: 6px 14px;
    border-radius: 999px;
    color: var(--muted);
    text-decoration: none;
    font-size: 0.875rem;
  }

  nav a:hover {
    color: var(--text);
  }

  nav a[aria-current="page"] {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .b-main {
    max-width: 1180px;
    margin: 0 auto;
    padding: 14px 20px 80px;
  }
</style>
