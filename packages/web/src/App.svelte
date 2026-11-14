<script lang="ts">
  import type { HealthResponse, SourceStatus } from "@mosaik/shared";
  import { onMount } from "svelte";
  import { getHealth, getSources, syncSource } from "./lib/api";

  const REFRESH_MS = 30_000;

  let health = $state<HealthResponse | null>(null);
  let sources = $state<SourceStatus[]>([]);
  let error = $state<string | null>(null);
  let syncing = $state<Record<string, boolean>>({});

  async function refresh() {
    try {
      const [nextHealth, nextSources] = await Promise.all([getHealth(), getSources()]);
      health = nextHealth;
      sources = nextSources.sources;
      error = null;
    } catch (cause) {
      health = null;
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function sync(source: string) {
    syncing[source] = true;
    try {
      await syncSource(source);
    } finally {
      syncing[source] = false;
      await refresh();
    }
  }

  const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });
  const when = (ms: number | null) => (ms === null ? "nunca" : dateTime.format(ms));

  /** What each connector reports, in words. Keys not listed here are not shown. */
  const SUMMARY_LABELS: Record<string, string> = {
    notes: "notas",
    reviews: "repasos",
    reviewsNew: "repasos nuevos",
    unknownOrigin: "sin origen",
  };
  const number = new Intl.NumberFormat("es-AR");

  function summaryText(summary: Record<string, unknown> | null): string {
    if (!summary) return "";
    return Object.entries(SUMMARY_LABELS)
      .filter(([key]) => typeof summary[key] === "number")
      .map(([key, label]) => `${number.format(summary[key] as number)} ${label}`)
      .join(" · ");
  }

  function warningsOf(summary: Record<string, unknown> | null): string[] {
    const warnings = summary?.warnings;
    return Array.isArray(warnings) ? warnings.filter((item): item is string => typeof item === "string") : [];
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  });
</script>

<main>
  <header>
    <h1>Mosaik</h1>
    <p class="tagline">Tus métricas de alemán, juntas.</p>
  </header>

  <section class="card" aria-labelledby="hub-title">
    <h2 id="hub-title">Hub</h2>
    {#if health}
      <p class="status ok">
        <span class="dot" aria-hidden="true"></span>
        Conectado · versión {health.version} · esquema v{health.schemaVersion}
      </p>
    {:else if error}
      <p class="status down">
        <span class="dot" aria-hidden="true"></span>
        Sin conexión con el hub ({error}). ¿Está corriendo <code>npm run dev</code>?
      </p>
    {:else}
      <p class="status">Conectando…</p>
    {/if}
  </section>

  <section class="card" aria-labelledby="sources-title">
    <h2 id="sources-title">Fuentes</h2>
    {#if sources.length === 0}
      <p class="muted">
        Todavía no hay conectores. Anki llega en la fase 1, GameSentenceMiner en la 2 y Deuchan en la 3.
      </p>
    {:else}
      <table>
        <thead>
          <tr>
            <th scope="col">Fuente</th>
            <th scope="col">Última sincronización</th>
            <th scope="col">Estado</th>
            <th scope="col"><span class="visually-hidden">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {#each sources as source (source.source)}
            <tr>
              <td>
                <span class="source-name">{source.source}</span>
                {#if summaryText(source.lastSummary)}
                  <span class="summary">{summaryText(source.lastSummary)}</span>
                {/if}
                {#each warningsOf(source.lastSummary) as warning (warning)}
                  <span class="warning">{warning}</span>
                {/each}
              </td>
              <td>{when(source.lastOkAt)}</td>
              <td>
                {#if source.running || syncing[source.source]}
                  Sincronizando…
                {:else if source.lastError}
                  <span class="error" title={source.lastError}>Error: {source.lastError}</span>
                {:else if source.lastOkAt}
                  OK
                {:else}
                  —
                {/if}
              </td>
              <td>
                <button
                  type="button"
                  disabled={!source.registered || source.running || syncing[source.source]}
                  onclick={() => sync(source.source)}
                >
                  Sincronizar
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</main>

<style>
  main {
    max-width: 880px;
    margin: 0 auto;
    padding: 32px 16px 64px;
  }

  header {
    margin-bottom: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    letter-spacing: -0.02em;
  }

  .tagline {
    margin: 4px 0 0;
    color: var(--muted);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 16px;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 1rem;
    font-weight: 600;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--muted);
    flex: none;
  }

  .status.ok .dot {
    background: var(--ok);
  }

  .status.down .dot {
    background: var(--danger);
  }

  .muted {
    color: var(--muted);
    margin: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: left;
    padding: 8px 4px;
    border-bottom: 1px solid var(--border);
  }

  th {
    font-weight: 500;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .error {
    color: var(--danger);
  }

  .source-name {
    font-weight: 500;
  }

  .summary,
  .warning {
    display: block;
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .warning {
    color: var(--warning);
  }

  button {
    font: inherit;
    padding: 4px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
