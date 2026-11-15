<script lang="ts">
  /** Minimal: a quiet top line of text links, and a lot of room for the numbers. */
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

<header class="m-top">
  <a class="m-mark" href="#/">mosaik</a>
  <nav aria-label="Secciones">
    {#each links as link (link.href)}
      <a href={link.href} aria-current={active(link.page) ? "page" : undefined}>{link.label}</a>
    {/each}
  </nav>
</header>

<main class="m-main">
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
  .m-top {
    max-width: 920px;
    margin: 0 auto;
    padding: 36px 24px 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .m-mark {
    color: var(--text);
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    text-decoration: none;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;
  }

  nav a {
    color: var(--muted);
    text-decoration: none;
    font-size: 0.9375rem;
    padding-bottom: 2px;
    border-bottom: 1px solid transparent;
  }

  nav a:hover {
    color: var(--text);
  }

  nav a[aria-current="page"] {
    color: var(--text);
    border-bottom-color: var(--text);
  }

  .m-main {
    max-width: 920px;
    margin: 0 auto;
    padding: 56px 24px 96px;
  }
</style>
