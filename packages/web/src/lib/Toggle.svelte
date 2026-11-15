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
    padding: 2px;
    border-radius: var(--toggle-radius, 8px);
    background: var(--bg);
    border: 1px solid var(--border);
  }

  button {
    font: inherit;
    font-size: 0.75rem;
    padding: 3px 10px;
    border: 0;
    border-radius: calc(var(--toggle-radius, 8px) - 2px);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  button[aria-pressed="true"] {
    background: var(--accent, var(--series-gsm));
    color: var(--on-accent, #fff);
    font-weight: 600;
  }

  button:focus-visible {
    outline: 2px solid var(--accent, var(--series-gsm));
    outline-offset: 1px;
  }
</style>
