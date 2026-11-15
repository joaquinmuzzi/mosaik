<script lang="ts">
  import { getContents } from "../lib/api";
  import Cover from "../lib/Cover.svelte";
  import { dayShort, duration, number } from "../lib/format";
  import Info from "../lib/Info.svelte";
  import { load } from "../lib/load.svelte";
  import { NOTES } from "../lib/notes";
  import { hrefContent } from "../lib/router.svelte";
  import Toggle from "../lib/Toggle.svelte";

  const contents = load(getContents);
  let kind = $state<"all" | "game" | "video">("all");
  const shown = $derived((contents.data?.contents ?? []).filter((c) => kind === "all" || c.kind === kind));
</script>

<header class="k-head">
  <h1>Biblioteca</h1>
  <Info text={`${NOTES.gsmTime} ${NOTES.videoTime}`} label="Cómo se cuenta el tiempo" />
  <span class="k-spacer"></span>
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
  <p class="error">No se pudo leer la biblioteca: {contents.error}</p>
{:else if !contents.data}
  <p class="muted">Cargando…</p>
{:else if shown.length === 0}
  <p class="muted">Nada todavía.</p>
{:else}
  <ul class="k-grid">
    {#each shown as content (content.id)}
      <li>
        <a class="k-tile" href={hrefContent(content.id)}>
          <div class="k-cover"><Cover {content} /></div>
          <div class="k-info">
            <span class="k-title">{content.title ?? content.id}</span>
            <span class="k-meta">
              <span
                class="tile"
                style:background={content.kind === "video" ? "var(--series-youtube)" : "var(--series-gsm)"}
              ></span>
              {content.kind === "video" ? "Video" : "Juego"} ·
              <span class="figure">{duration(content.seconds)}</span>
              {#if content.cardsMined > 0}· {number.format(content.cardsMined)} tarjetas{/if}
            </span>
            {#if content.lastDay}<span class="meta">{dayShort(content.lastDay)}</span>{/if}
          </div>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .k-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    line-height: 1.15;
  }

  .k-spacer {
    flex: 1;
  }

  .k-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 16px;
  }

  .k-tile {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    border-radius: var(--radius-card);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
    transition:
      background-color 150ms var(--ease),
      border-color 150ms var(--ease);
  }

  .k-tile:hover {
    background: var(--surface-2);
    border-color: var(--border-strong);
  }

  .k-cover {
    aspect-ratio: 3 / 4;
  }

  .k-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
  }

  .k-title {
    font-weight: 500;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .k-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    color: var(--secondary);
    font-size: 0.9286rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .k-tile {
      transition: none;
    }
  }
</style>
