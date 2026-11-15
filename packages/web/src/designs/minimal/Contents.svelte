<script lang="ts">
  import { getContents } from "../../lib/api";
  import Cover from "../../lib/Cover.svelte";
  import { KIND_LABELS, dayShort, duration, number } from "../../lib/format";
  import Info from "../../lib/Info.svelte";
  import { load } from "../../lib/load.svelte";
  import { NOTES } from "../../lib/notes";
  import { hrefContent } from "../../lib/router.svelte";

  const contents = load(getContents);
  let kind = $state<"all" | "game" | "video">("all");
  const shown = $derived((contents.data?.contents ?? []).filter((c) => kind === "all" || c.kind === kind));
  const filters = [
    ["all", "Todo"],
    ["game", "Juegos"],
    ["video", "Videos"],
  ] as const;
</script>

<header class="m-head">
  <h1>Contenido <Info text={`${NOTES.gsmTime} ${NOTES.videoTime}`} label="Cómo se cuenta el tiempo" /></h1>
  <div class="m-filters" role="group" aria-label="Tipo de contenido">
    {#each filters as [value, label] (value)}
      <button type="button" aria-pressed={kind === value} onclick={() => (kind = value)}>{label}</button>
    {/each}
  </div>
</header>

{#if contents.error}
  <p class="error">No se pudo leer el contenido: {contents.error}</p>
{:else if !contents.data}
  <p class="muted">Cargando…</p>
{:else}
  <ul class="m-list">
    {#each shown as content (content.id)}
      <li>
        <a href={hrefContent(content.id)}>
          <span class="m-cover"><Cover {content} /></span>
          <span class="m-text">
            <span class="m-title">{content.title ?? content.id}</span>
            <span class="m-meta"
              >{KIND_LABELS[content.kind] ?? content.kind}{content.lastDay
                ? ` · ${dayShort(content.lastDay)}`
                : ""}</span
            >
          </span>
          <span class="m-nums">
            <span class="m-time">{duration(content.seconds)}</span>
            {#if content.cardsMined > 0}<span class="m-meta"
                >{number.format(content.cardsMined)} tarjetas</span
              >{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .m-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 32px;
  }

  h1 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 2.25rem;
    font-weight: 300;
    letter-spacing: -0.03em;
  }

  .m-filters {
    display: flex;
    gap: 16px;
  }

  .m-filters button {
    font: inherit;
    padding: 0 0 2px;
    border: 0;
    border-bottom: 1px solid transparent;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }

  .m-filters button[aria-pressed="true"] {
    color: var(--text);
    border-bottom-color: var(--text);
  }

  .m-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .m-list a {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    align-items: center;
    gap: 20px;
    padding: 18px 0;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }

  .m-list a:hover .m-title {
    text-decoration: underline;
  }

  .m-cover {
    width: 52px;
    height: 52px;
    border-radius: 8px;
    overflow: hidden;
  }

  .m-text,
  .m-nums {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .m-nums {
    align-items: flex-end;
  }

  .m-title {
    font-size: 1.0625rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .m-meta {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .m-time {
    font-size: 1.25rem;
    font-weight: 300;
    font-variant-numeric: tabular-nums;
  }
</style>
