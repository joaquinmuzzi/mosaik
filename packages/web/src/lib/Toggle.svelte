<script lang="ts" generics="T extends string">
  /** A small segmented switch: one of a few options, as pressed buttons. */
  let {
    options,
    value = $bindable(),
    label,
  }: { options: readonly (readonly [T, string])[]; value: T; label: string } = $props();
</script>

<div class="toggle" role="group" aria-label={label}>
  {#each options as [option, text] (option)}
    <button type="button" aria-pressed={value === option} onclick={() => (value = option)}>{text}</button>
  {/each}
</div>

<style>
  .toggle {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--toggle-radius, 8px);
    background: var(--bg);
    border: 1px solid var(--border);
  }

  button {
    font: inherit;
    font-size: 0.8571rem;
    height: 24px;
    padding: 0 10px;
    border: 1px solid transparent;
    /* Nested radius: the outer radius minus the 2px padding */
    border-radius: calc(var(--toggle-radius, 8px) - 2px);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition:
      background-color 150ms var(--ease),
      color 150ms var(--ease);
  }

  button:hover {
    color: var(--text);
  }

  button[aria-pressed="true"] {
    background: var(--surface-2);
    border-color: var(--border);
    color: var(--text);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
