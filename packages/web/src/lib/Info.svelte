<script lang="ts">
  /**
   * An (i) next to a number: its explanation shows on hover, focus or tap, instead of filling the
   * screen with notes. Escape or a click elsewhere closes it.
   */
  let { text, label = "¿Cómo se calcula?" }: { text: string; label?: string } = $props();

  let open = $state(false);
  let pinned = $state(false);
  let root: HTMLSpanElement;
  const id = `info-${Math.random().toString(36).slice(2, 9)}`;

  function outside(event: PointerEvent) {
    if (pinned && !root.contains(event.target as Node)) {
      pinned = false;
      open = false;
    }
  }
</script>

<svelte:window
  onpointerdown={outside}
  onkeydown={(event) => {
    if (event.key === "Escape") {
      pinned = false;
      open = false;
    }
  }}
/>

<span
  class="info"
  bind:this={root}
  role="group"
  onmouseenter={() => (open = true)}
  onmouseleave={() => (open = pinned)}
>
  <button
    type="button"
    aria-label={label}
    aria-expanded={open}
    aria-describedby={open ? id : undefined}
    onfocus={() => (open = true)}
    onblur={() => (open = pinned)}
    onclick={() => {
      pinned = !pinned;
      open = pinned;
    }}>i</button
  >
  {#if open}
    <span class="info-pop" role="tooltip" {id}>{text}</span>
  {/if}
</span>

<style>
  .info {
    position: relative;
    display: inline-flex;
    vertical-align: middle;
  }

  button {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--muted);
    background: transparent;
    color: var(--muted);
    font:
      600 11px/1 Georgia,
      "Times New Roman",
      serif;
    font-style: italic;
    cursor: help;
  }

  button:hover,
  button:focus-visible,
  button[aria-expanded="true"] {
    color: var(--text);
    border-color: var(--text);
  }

  button:focus-visible {
    outline: 2px solid var(--accent, var(--series-gsm));
    outline-offset: 2px;
  }

  .info-pop {
    position: absolute;
    z-index: 40;
    left: 50%;
    top: calc(100% + 6px);
    transform: translateX(-50%);
    width: max-content;
    max-width: min(300px, 80vw);
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 0.8125rem;
    font-weight: 400;
    line-height: 1.45;
    text-align: left;
    text-transform: none;
    letter-spacing: normal;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.3);
  }
</style>
