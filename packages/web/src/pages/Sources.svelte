<script lang="ts">
  import type { SourceStatus } from "@mosaik/shared";
  import { onMount } from "svelte";
  import { getSources, syncSource } from "../lib/api";
  import { isServer } from "../lib/auth.svelte";
  import Devices from "../lib/Devices.svelte";
  import { duration, number } from "../lib/format";

  let sources = $state<SourceStatus[]>([]);
  let error = $state<string | null>(null);
  let syncing = $state<Record<string, boolean>>({});

  async function refresh() {
    try {
      sources = (await getSources()).sources;
      error = null;
    } catch (cause) {
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

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  });

  const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });
  const when = (ms: number | null) => (ms === null ? "nunca" : dateTime.format(ms));

  /** What each source reports, in words. Keys not listed here are not shown. */
  const SUMMARY_LABELS: Record<string, (value: number) => string> = {
    notes: (value) => `${number.format(value)} notas`,
    reviews: (value) => `${number.format(value)} repasos`,
    reviewsNew: (value) => `${number.format(value)} repasos nuevos`,
    unknownOrigin: (value) => `${number.format(value)} sin origen`,
    lines: (value) => `${number.format(value)} líneas`,
    sessions: (value) => `${number.format(value)} sesiones`,
    readingSeconds: (value) => `${duration(value)} de lectura`,
    cardsFromGsm: (value) => `${number.format(value)} tarjetas minadas`,
    videos: (value) => `${number.format(value)} videos`,
    watchSeconds: (value) => `${duration(value)} en sesiones de video`,
    days: (value) => `${number.format(value)} días`,
  };

  function summaryText(summary: Record<string, unknown> | null): string {
    if (!summary) return "";
    return Object.entries(SUMMARY_LABELS)
      .filter(([key]) => typeof summary[key] === "number")
      .map(([key, format]) => format(summary[key] as number))
      .join(" · ");
  }

  const EXPORTS = [
    {
      href: "/api/export/days.csv",
      label: "Días (CSV)",
      detail: "Un renglón por día: segundos de juego, de Deuchan y en total, repasos y tarjetas minadas.",
    },
    {
      href: "/api/export/contents.csv",
      label: "Biblioteca (CSV)",
      detail:
        "Cada juego y video con su tiempo, sesiones, palabras, caracteres, tarjetas y primer y último día.",
    },
    {
      href: "/api/export/cards.csv",
      label: "Tarjetas (CSV)",
      detail: "Cada nota de Anki que Mosaik conoce, con su origen, mazo, contenido y día de creación.",
    },
    {
      href: "/api/export/backup",
      label: "Copia completa (SQLite)",
      detail:
        "La base de Mosaik entera, también las líneas leídas y las portadas. Para restaurarla: cerrá el hub, reemplazá mosaik.db (en %LOCALAPPDATA%\\Mosaik) por este archivo y borrá mosaik.db-wal y mosaik.db-shm si están.",
    },
  ];

  function warningsOf(summary: Record<string, unknown> | null): string[] {
    const warnings = summary?.warnings;
    return Array.isArray(warnings) ? warnings.filter((item): item is string => typeof item === "string") : [];
  }
</script>

<section class="card" aria-labelledby="sources-title">
  <h2 id="sources-title">Fuentes</h2>
  <p class="note">
    {#if isServer()}
      Cada computadora manda lo suyo: su agente lee Anki y GameSentenceMiner cada 5 minutos, y Deuchan manda
      sus datos cada minuto. Una fila por fuente y computadora.
    {:else}
      Anki y GameSentenceMiner se leen al arrancar y cada 5 minutos (también a pedido). Deuchan manda sus
      datos solo, cada minuto, cuando la opción "Send to Mosaik" está prendida.
    {/if}
  </p>
  {#if error}
    <p class="error">No se pudo leer el estado: {error}</p>
  {:else if sources.length === 0}
    <p class="muted">El hub todavía no informó ninguna fuente.</p>
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
        {#each sources as source (`${source.source}|${source.device}`)}
          <tr>
            <td>
              <span class="source-name"
                >{source.source}{#if isServer() || source.device !== "principal"}
                  <span class="device">· {source.deviceLabel}</span>{/if}</span
              >
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
              {#if source.registered}
                <button
                  type="button"
                  disabled={source.running || syncing[source.source]}
                  onclick={() => sync(source.source)}
                >
                  Sincronizar
                </button>
              {:else}
                <!-- A source that pushes (Deuchan, or an agent): the hub does not fetch it -->
                <span class="summary"
                  >{source.source === "deuchan" ? "la envía la extensión" : "la manda su agente"}</span
                >
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<section class="card" aria-labelledby="export-title">
  <h2 id="export-title">Exportar</h2>
  <p class="note">
    Tus datos como archivos, para abrirlos en una planilla o guardarlos aparte. Se generan en el momento y no
    salen de esta computadora.
  </p>
  <ul class="exports">
    {#each EXPORTS as item (item.href)}
      <li>
        <a class="download" href={item.href} download>{item.label}</a>
        <span class="summary">{item.detail}</span>
      </li>
    {/each}
  </ul>
</section>

{#if isServer()}
  <Devices />
{/if}

<style>
  .device {
    color: var(--muted);
    font-weight: 400;
  }

  .exports {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }

  .download {
    font-weight: 500;
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
</style>
