<script lang="ts">
  /**
   * A content's cover: the game's image, the video's thumbnail or the page's image. Without one (or if
   * it fails to load), a tile with the initials in the source's color.
   */
  import type { ContentSummary } from "@mosaik/shared";
  import { KIND_LABELS } from "./format";

  let { content, badge = false }: { content: ContentSummary; badge?: boolean } = $props();

  let failed = $state(false);
  /** Anything but a game comes from Deuchan, whose images have any shape. */
  const isVideo = $derived(content.kind !== "game");
  const initials = $derived(
    (content.title ?? "?")
      .replace(/^\(\d+\)\s*/, "")
      .split(/[\s:–-]+/)
      .filter((word) => /^[\p{L}\p{N}]/u.test(word))
      .slice(0, 2)
      .map((word) => [...word][0]!.toUpperCase())
      .join(""),
  );
</script>

<div class="cover" class:video={isVideo}>
  {#if content.cover && !failed && isVideo}
    <!-- A thumbnail in a tile of another shape: whole, over a blurred copy of itself -->
    <img class="backdrop" src={content.cover} alt="" aria-hidden="true" />
    <img class="contain" src={content.cover} alt="" loading="lazy" onerror={() => (failed = true)} />
  {:else if content.cover && !failed}
    <img src={content.cover} alt="" loading="lazy" onerror={() => (failed = true)} />
  {:else}
    <span class="initials" aria-hidden="true">{initials}</span>
  {/if}
  {#if badge}
    <span class="kind">{KIND_LABELS[content.kind] ?? content.kind}</span>
  {/if}
</div>

<style>
  .cover {
    container-type: inline-size;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: grid;
    grid-template: 100% / 100%;
    place-items: center;
    /* No cover yet: a flat tile in a dim tone of the source's color, with the initials in it */
    background: color-mix(in srgb, var(--series-gsm) 22%, var(--surface));
    color: var(--series-gsm);
  }

  .cover.video {
    background: color-mix(in srgb, var(--series-youtube) 22%, var(--surface));
    color: var(--series-youtube);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  img.backdrop {
    position: absolute;
    inset: -10%;
    width: 120%;
    height: 120%;
    filter: blur(18px) brightness(0.7);
  }

  img.contain {
    position: relative;
    object-fit: contain;
  }

  .initials {
    font-weight: 500;
    font-size: clamp(1.25rem, 30cqi, 3rem);
  }

  .kind {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgb(20 20 21 / 0.8);
    color: var(--text);
    font-size: 0.8571rem;
  }
</style>
