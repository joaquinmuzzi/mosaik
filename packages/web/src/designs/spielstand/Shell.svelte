<script lang="ts">
  /** Spielstand: a game's status screen, with menu tabs in German (and their Spanish names). */
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
    { href: "#/", page: "home", label: "Status", es: "Estado" },
    { href: "#/contenido", page: "contents", label: "Spielstände", es: "Contenido" },
    { href: "#/anki", page: "anki", label: "Sammlung", es: "Anki" },
    { href: "#/buscar", page: "search", label: "Suche", es: "Buscar" },
    { href: "#/fuentes", page: "sources", label: "System", es: "Fuentes" },
  ] as const;
  const active = (page: string) =>
    router.route.page === page || (page === "contents" && router.route.page === "content");
</script>

<header class="s-top">
  <a class="s-title" href="#/"><span aria-hidden="true">◆</span> Mosaik <small>Deutsch</small></a>
  <nav aria-label="Secciones">
    {#each links as link (link.href)}
      <a href={link.href} aria-current={active(link.page) ? "page" : undefined} title={link.es}>
        <span class="s-de">{link.label}</span><span class="s-es">{link.es}</span>
      </a>
    {/each}
  </nav>
</header>

<main class="s-main">
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
  .s-top {
    max-width: 1120px;
    margin: 0 auto;
    padding: 22px 20px 8px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .s-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--text);
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-decoration: none;
  }

  .s-title span {
    color: var(--series-mined);
  }

  .s-title small {
    font-size: 0.75rem;
    letter-spacing: 0.2em;
    color: var(--muted);
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  nav a {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    color: var(--muted);
    text-decoration: none;
    line-height: 1.2;
  }

  .s-de {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .s-es {
    font-size: 0.6875rem;
  }

  nav a:hover {
    color: var(--text);
    border-color: var(--frame);
  }

  nav a[aria-current="page"] {
    color: var(--on-accent);
    background: var(--accent);
    border-color: var(--accent);
  }

  .s-main {
    max-width: 1120px;
    margin: 0 auto;
    padding: 14px 20px 80px;
  }
</style>
