<script lang="ts">
  import type { HealthResponse } from "@mosaik/shared";
  import { onMount } from "svelte";
  import { getHealth } from "./lib/api";
  import { router } from "./lib/router.svelte";
  import Anki from "./pages/Anki.svelte";
  import Day from "./pages/Day.svelte";
  import Home from "./pages/Home.svelte";
  import Sources from "./pages/Sources.svelte";

  let health = $state<HealthResponse | null>(null);
  let down = $state(false);

  async function check() {
    try {
      health = await getHealth();
      down = false;
    } catch {
      health = null;
      down = true;
    }
  }

  onMount(() => {
    void check();
    const timer = setInterval(() => void check(), 30_000);
    return () => clearInterval(timer);
  });

  const links = [
    { href: "#/", page: "home", label: "Inicio" },
    { href: "#/anki", page: "anki", label: "Anki" },
    { href: "#/fuentes", page: "sources", label: "Fuentes" },
  ] as const;
</script>

<header>
  <div class="brand">
    <h1><a href="#/">Mosaik</a></h1>
    <p class="status" class:down>
      <span class="dot" aria-hidden="true"></span>
      {#if health}
        Hub conectado · v{health.version}
      {:else if down}
        Sin conexión con el hub. ¿Está corriendo <code>npm run dev</code>?
      {:else}
        Conectando…
      {/if}
    </p>
  </div>
  <nav aria-label="Secciones">
    {#each links as link (link.href)}
      <a href={link.href} aria-current={router.route.page === link.page ? "page" : undefined}>{link.label}</a>
    {/each}
  </nav>
</header>

<main>
  {#if router.route.page === "day"}
    <Day day={router.route.day} />
  {:else if router.route.page === "anki"}
    <Anki />
  {:else if router.route.page === "sources"}
    <Sources />
  {:else}
    <Home />
  {/if}
</main>

<style>
  header {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 16px 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-end;
    justify-content: space-between;
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
    letter-spacing: -0.02em;
  }

  h1 a {
    color: inherit;
    text-decoration: none;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
  }

  .status.down .dot {
    background: var(--danger);
  }

  nav {
    display: flex;
    gap: 4px;
  }

  nav a {
    padding: 6px 12px;
    border-radius: 8px;
    color: var(--muted);
    text-decoration: none;
  }

  nav a:hover {
    color: var(--text);
  }

  nav a[aria-current="page"] {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
  }

  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 8px 16px 64px;
  }
</style>
