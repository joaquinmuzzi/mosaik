<script lang="ts">
  import type { SearchResponse } from "@mosaik/shared";
  import { search } from "../lib/api";
  import { cleanLine, dayShort, timeOf } from "../lib/format";
  import { hrefContent, hrefDay, hrefSearch } from "../lib/router.svelte";

  let { query }: { query: string } = $props();

  const MIN = 3;
  let input = $state("");
  let result = $state<SearchResponse | null>(null);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // The query lives in the address (#/buscar?q=…), so a search can be bookmarked and the back button works
  $effect(() => {
    input = query;
    const wanted = query.trim();
    if ([...wanted].length < MIN) {
      result = null;
      return;
    }
    search(wanted)
      .then((response) => {
        if (response.query === query.trim()) result = response;
        error = null;
      })
      .catch((cause: unknown) => (error = cause instanceof Error ? cause.message : String(cause)));
  });

  /** The text split around the query, ignoring case, to mark it. Text only: nothing is parsed as HTML. */
  function parts(text: string, needle: string): { text: string; match: boolean }[] {
    const clean = cleanLine(text);
    const lower = clean.toLocaleLowerCase("de");
    const target = needle.trim().toLocaleLowerCase("de");
    if (!target) return [{ text: clean, match: false }];
    const result: { text: string; match: boolean }[] = [];
    let from = 0;
    for (let at = lower.indexOf(target); at !== -1; at = lower.indexOf(target, from)) {
      if (at > from) result.push({ text: clean.slice(from, at), match: false });
      result.push({ text: clean.slice(at, at + target.length), match: true });
      from = at + target.length;
    }
    if (from < clean.length) result.push({ text: clean.slice(from), match: false });
    return result;
  }
</script>

<section class="card" aria-labelledby="search-title">
  <h2 id="search-title">Buscar oraciones</h2>
  <p class="note">
    En todo lo que leíste en GameSentenceMiner. Encuentra una palabra también dentro de otras ("wand" en
    "Einwand"), sin importar mayúsculas ni tildes. Hacen falta al menos {MIN} letras.
  </p>
  <input
    type="search"
    bind:value={input}
    oninput={() => {
      clearTimeout(timer);
      timer = setTimeout(() => (location.hash = hrefSearch(input)), 250);
    }}
    placeholder="Por ejemplo: Einspruch"
    aria-label="Palabra o frase a buscar"
  />
</section>

{#if error}
  <p class="error">No se pudo buscar: {error}</p>
{:else if result}
  <p class="muted count">
    {result.hits.length === 0
      ? "Ninguna oración."
      : `${result.hits.length}${result.more ? "+" : ""} ${result.hits.length === 1 ? "oración" : "oraciones"}, las más nuevas primero.`}
  </p>
  <ol class="hits">
    {#each result.hits as hit (hit.id)}
      <li class="card">
        <p class="text">
          {#each parts(hit.text, result.query) as part, index (index)}{#if part.match}<mark>{part.text}</mark
              >{:else}{part.text}{/if}{/each}
        </p>
        <p class="meta">
          {#if hit.contentId}<a href={hrefContent(hit.contentId)}>{hit.contentTitle ?? hit.contentId}</a> ·{/if}
          <a href={hrefDay(hit.day)}>{dayShort(hit.day)}</a>
          {timeOf(hit.ts, timeZone)}
          {#each hit.mined as word (word)}<span class="badge" title="Tarjeta minada de esta oración"
              >minaste «{word}»</span
            >{/each}
        </p>
      </li>
    {/each}
  </ol>
{/if}

<style>
  input {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    font-size: 1.0625rem;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }

  .count {
    margin: 0 0 8px;
  }

  .hits {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .hits li {
    padding: 12px 16px;
    margin-bottom: 8px;
  }

  .text {
    margin: 0 0 4px;
  }

  mark {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    color: inherit;
    border-radius: 3px;
    padding: 0 1px;
  }

  .meta {
    margin: 0;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 0 8px;
    border-radius: 4px;
    border: 1px solid var(--border-strong);
    color: var(--text);
  }
</style>
