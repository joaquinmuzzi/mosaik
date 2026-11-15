<script lang="ts">
  /**
   * A content's cover: GSM's game image, or a YouTube thumbnail when turned on. Without one (or if it
   * fails to load), a tile with the initials in the source's color.
   */
  import type { ContentSummary } from "@mosaik/shared";

  let { content, badge = false }: { content: ContentSummary; badge?: boolean } = $props();

  let failed = $state(false);
  const isVideo = $derived(content.kind === "video");
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
    <!-- A 16:9 thumbnail in a tile of another shape: whole, over a blurred copy of itself -->
    <img class="backdrop" src={content.cover} alt="" aria-hidden="true" />
    <img class="contain" src={content.cover} alt="" loading="lazy" onerror={() => (failed = true)} />
  {:else if content.cover && !failed}
    <img src={content.cover} alt="" loading="lazy" onerror={() => (failed = true)} />
  {:else}
    <span class="initials" aria-hidden="true">{initials}</span>
  {/if}
  {#if badge}
    <span class="kind">{isVideo ? "Video" : "Juego"}</span>
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
    place-items: center;
    background:
      radial-gradient(circle at 30% 20%, rgb(255 255 255 / 0.18), transparent 60%),
      linear-gradient(140deg, var(--series-gsm), color-mix(in srgb, var(--series-gsm) 45%, #000));
  }

  .cover.video {
    background:
      radial-gradient(circle at 30% 20%, rgb(255 255 255 / 0.18), transparent 60%),
      linear-gradient(140deg, var(--series-youtube), color-mix(in srgb, var(--series-youtube) 45%, #000));
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
    color: #fff;
    font-weight: 700;
    font-size: clamp(1.25rem, 30cqi, 3rem);
    letter-spacing: 0.04em;
    text-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
  }

  .kind {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.65);
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
