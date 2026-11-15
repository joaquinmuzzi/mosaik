<script lang="ts">
  /**
   * A content's cover, with the ways to change it: look the game up on Steam and pick one, upload an
   * image, or go back to the automatic one (GSM's image, or the YouTube thumbnail).
   */
  import type { ContentSummary, SteamCandidate } from "@mosaik/shared";
  import { removeCover, searchSteamCovers, setSteamCover, uploadCover } from "./api";
  import Cover from "./Cover.svelte";
  import Info from "./Info.svelte";

  let { content, onchange }: { content: ContentSummary; onchange: () => void } = $props();

  let open = $state(false);
  let query = $state("");
  let results = $state<SteamCandidate[] | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let file: HTMLInputElement;

  const chosen = $derived(content.coverSource === "manual" || content.coverSource === "steam");

  async function run(task: () => Promise<unknown>, after = true) {
    busy = true;
    error = null;
    try {
      await task();
      if (after) onchange();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function openSteam() {
    open = !open;
    if (open && !query) {
      // Window titles from OBS often carry a "(3) " counter or a " - App" suffix
      query = (content.title ?? "")
        .replace(/^\(\d+\)\s*/, "")
        .split(/ - (YouTube|Brave|Microsoft)/)[0]!
        .trim();
      void search();
    }
  }

  async function search() {
    results = null;
    await run(async () => {
      results = (await searchSteamCovers(query)).results;
    }, false);
  }
</script>

<div class="picker">
  <div class="art" class:video={content.kind === "video"}><Cover {content} /></div>
  <div class="actions">
    <button type="button" onclick={openSteam} aria-expanded={open} disabled={busy}>Buscar en Steam</button>
    <button type="button" onclick={() => file.click()} disabled={busy}>Subir imagen</button>
    {#if chosen}
      <button type="button" class="quiet" onclick={() => run(() => removeCover(content.id))} disabled={busy}>
        Quitar portada
      </button>
    {/if}
    <Info
      text="La búsqueda le manda a Steam el texto que escribas (no otra cosa) y solo cuando tocás «Buscar». La imagen que elijas o subas queda guardada en Mosaik y ninguna sincronización la reemplaza."
      label="Sobre las portadas"
    />
    <input
      bind:this={file}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      hidden
      onchange={(event) => {
        const chosenFile = event.currentTarget.files?.[0];
        if (chosenFile) void run(() => uploadCover(content.id, chosenFile));
        event.currentTarget.value = "";
      }}
    />
  </div>
</div>

{#if error}<p class="error">No se pudo cambiar la portada: {error}</p>{/if}

{#if open}
  <section class="steam" aria-label="Portadas de Steam">
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void search();
      }}
    >
      <input type="search" bind:value={query} aria-label="Juego a buscar en Steam" />
      <button type="submit" disabled={busy || query.trim().length < 2}>Buscar</button>
    </form>
    {#if busy && !results}
      <p class="muted">Buscando…</p>
    {:else if results && results.length === 0}
      <p class="muted">Steam no encontró nada con ese nombre. Probá con otro, o subí una imagen.</p>
    {:else if results}
      <ul class="results">
        {#each results as result (result.appId)}
          <li>
            <button
              type="button"
              disabled={busy}
              onclick={() =>
                run(async () => {
                  await setSteamCover(content.id, result.appId);
                  open = false;
                })}
            >
              <img
                src={result.image}
                alt=""
                loading="lazy"
                onerror={(event) => {
                  const img = event.currentTarget as HTMLImageElement;
                  if (img.src !== result.header) img.src = result.header;
                }}
              />
              <span>{result.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 180px;
  }

  .art {
    aspect-ratio: 3 / 4;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .art.video {
    aspect-ratio: 16 / 9;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  button {
    font: inherit;
    font-size: 0.8125rem;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: var(--accent, var(--muted));
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .quiet {
    color: var(--muted);
  }

  .steam {
    flex-basis: 100%;
    width: 100%;
    box-sizing: border-box;
    margin: 0;
    padding: 14px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  form {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  form input {
    flex: 1;
    font: inherit;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }

  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 12px;
  }

  .results button {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 6px;
    text-align: left;
  }

  .results img {
    width: 100%;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    border-radius: 6px;
    background: var(--bg);
  }

  .results span {
    font-size: 0.75rem;
    line-height: 1.3;
  }
</style>
