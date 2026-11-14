<script lang="ts">
  import type { ContentSummary } from "@mosaik/shared";
  import { onMount } from "svelte";
  import { getContents } from "../lib/api";
  import { KIND_LABELS, dayShort, duration, number } from "../lib/format";
  import { hrefContent } from "../lib/router.svelte";

  let contents = $state<ContentSummary[] | null>(null);
  let error = $state<string | null>(null);
  let kind = $state<"all" | "game" | "video">("all");

  onMount(() => {
    getContents()
      .then((result) => (contents = result.contents))
      .catch((cause: unknown) => (error = cause instanceof Error ? cause.message : String(cause)));
  });

  const shown = $derived((contents ?? []).filter((content) => kind === "all" || content.kind === kind));
  const swatch = (content: ContentSummary) =>
    content.kind === "video" ? "var(--series-youtube)" : "var(--series-gsm)";
</script>

<section class="card" aria-labelledby="contents-title">
  <h2 id="contents-title">Contenido</h2>
  <p class="note">
    Lo que leíste en GameSentenceMiner y lo que miraste en YouTube (según Deuchan), con el tiempo, las
    sesiones y las tarjetas que minaste de cada uno. Ordenado por la última vez.
  </p>
  <div class="filters" role="group" aria-label="Tipo de contenido">
    {#each [["all", "Todo"], ["game", "Juegos"], ["video", "Videos"]] as const as [value, label] (value)}
      <button type="button" aria-pressed={kind === value} onclick={() => (kind = value)}>{label}</button>
    {/each}
  </div>

  {#if error}
    <p class="error">No se pudo leer el contenido: {error}</p>
  {:else if !contents}
    <p class="muted">Cargando…</p>
  {:else if shown.length === 0}
    <p class="muted">Nada todavía.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th scope="col">Título</th>
          <th scope="col">Tipo</th>
          <th scope="col" class="num">Tiempo</th>
          <th scope="col" class="num">Tarjetas</th>
          <th scope="col" class="num">Última vez</th>
        </tr>
      </thead>
      <tbody>
        {#each shown as content (content.id)}
          <tr>
            <td>
              <span class="swatch" style:background={swatch(content)} aria-hidden="true"></span>
              <a href={hrefContent(content.id)}>{content.title ?? content.id}</a>
            </td>
            <td>{KIND_LABELS[content.kind] ?? content.kind}</td>
            <td class="num">{duration(content.seconds)}</td>
            <td class="num">{content.cardsMined > 0 ? number.format(content.cardsMined) : "—"}</td>
            <td class="num">{content.lastDay ? dayShort(content.lastDay) : "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .filters {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
  }

  .filters button {
    font: inherit;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .filters button[aria-pressed="true"] {
    background: var(--bg);
    color: var(--text);
    border-color: var(--muted);
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    margin-right: 6px;
  }
</style>
