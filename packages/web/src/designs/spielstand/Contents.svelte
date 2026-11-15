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

<header class="s-head">
  <p class="s-heading">
    Spielstände <small>lo que leíste y miraste</small>
    <Info text={`${NOTES.gsmTime} ${NOTES.videoTime}`} />
  </p>
  <Toggle
    label="Tipo de contenido"
    options={[
      ["all", "Alle · todo"],
      ["game", "Spiele · juegos"],
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
  <ol class="s-slots">
    {#each shown as content, index (content.id)}
      <li>
        <a class="s-panel s-slot" href={hrefContent(content.id)}>
          <span class="s-slotnum s-num">{String(index + 1).padStart(2, "0")}</span>
          <span class="s-art"><Cover {content} /></span>
          <span class="s-info">
            <span class="s-name">{content.title ?? content.id}</span>
            <span class="s-kind"
              >{KIND_LABELS[content.kind] ?? content.kind}{content.lastDay
                ? ` · zuletzt ${dayShort(content.lastDay)}`
                : ""}</span
            >
          </span>
          <span class="s-stat">
            <span class="s-label">Spielzeit</span>
            <span class="s-num">{duration(content.seconds)}</span>
          </span>
          <span class="s-stat">
            <span class="s-label">Beute</span>
            <span class="s-num"
              >{content.cardsMined > 0 ? `${number.format(content.cardsMined)} ✦` : "—"}</span
            >
          </span>
        </a>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .s-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .s-head .s-heading {
    margin: 0;
    font-size: 1rem;
  }

  .s-slots {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }

  .s-slot {
    display: grid;
    grid-template-columns: 34px 64px 1fr 120px 90px;
    align-items: center;
    gap: 16px;
    color: var(--text);
    text-decoration: none;
  }

  .s-slot:hover,
  .s-slot:focus-visible {
    border-color: var(--accent);
  }

  .s-slotnum {
    color: var(--frame);
    font-size: 1.25rem;
    font-weight: 700;
  }

  .s-art {
    width: 64px;
    height: 64px;
    border: 1px solid var(--frame);
    border-radius: 4px;
    overflow: hidden;
  }

  .s-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .s-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .s-kind,
  .s-label {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .s-stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .s-label {
    font-size: 0.6875rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
  }

  @media (max-width: 1000px) {
    .s-slot {
      grid-template-columns: 56px 1fr auto;
    }

    .s-slotnum,
    .s-stat:last-child {
      display: none;
    }

    .s-art {
      width: 56px;
      height: 56px;
    }
  }
</style>
