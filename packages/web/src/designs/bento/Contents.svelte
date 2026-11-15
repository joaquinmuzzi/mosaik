<script lang="ts">
  import { getContents } from "../../lib/api";
  import Cover from "../../lib/Cover.svelte";
  import { KIND_LABELS, dayShort, duration, number } from "../../lib/format";
  import Info from "../../lib/Info.svelte";
  import { load } from "../../lib/load.svelte";
  import { NOTES } from "../../lib/notes";
  import { hrefContent } from "../../lib/router.svelte";
  import Toggle from "../../lib/Toggle.svelte";

  const contents = load(getContents);
  let kind = $state<"all" | "game" | "video">("all");
  const shown = $derived((contents.data?.contents ?? []).filter((c) => kind === "all" || c.kind === kind));
</script>

<header class="b-head">
  <h1>Contenido <Info text={`${NOTES.gsmTime} ${NOTES.videoTime}`} label="Cómo se cuenta el tiempo" /></h1>
  <Toggle
    label="Tipo de contenido"
    options={[
      ["all", "Todo"],
      ["game", "Juegos"],
      ["video", "Videos"],
    ] as const}
    bind:value={kind}
  />
</header>

{#if contents.error}
  <p class="error">No se pudo leer el contenido: {contents.error}</p>
{:else if !contents.data}
  <p class="muted">Cargando…</p>
{:else}
  <div class="b-grid">
    {#each shown as content, index (content.id)}
      <a class="b-cell b-item {index === 0 ? 's-6 r-2 featured' : 's-3'}" href={hrefContent(content.id)}>
        <span class="b-art"><Cover {content} badge /></span>
        <span class="b-body">
          <span class="b-title">{content.title ?? content.id}</span>
          <span class="b-sub">
            {KIND_LABELS[content.kind] ?? content.kind}{content.lastDay
              ? ` · ${dayShort(content.lastDay)}`
              : ""}
          </span>
          <span class="b-stats">
            <b>{duration(content.seconds)}</b>
            {#if content.cardsMined > 0}<span>{number.format(content.cardsMined)} tarjetas</span>{/if}
          </span>
        </span>
      </a>
    {/each}
  </div>
{/if}

<style>
  .b-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  h1 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 1.75rem;
  }

  .b-item {
    padding: 0;
  }

  .b-item:hover {
    border-color: var(--accent);
  }

  .b-art {
    display: block;
    height: 120px;
  }

  .featured .b-art {
    height: auto;
    flex: 1;
    min-height: 220px;
  }

  .b-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px 16px;
  }

  .b-title {
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .featured .b-title {
    font-size: 1.375rem;
  }

  .b-stats {
    display: flex;
    gap: 10px;
    margin-top: 6px;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .b-stats b {
    color: var(--text);
  }

  .featured .b-stats b {
    font-size: 1.5rem;
  }
</style>
