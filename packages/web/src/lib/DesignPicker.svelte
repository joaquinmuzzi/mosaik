<script lang="ts">
  import { DESIGNS, type DesignId, design, setDesign } from "./design.svelte";
</script>

<label class="design-picker">
  <span>Diseño</span>
  <select value={design.id} onchange={(event) => setDesign(event.currentTarget.value as DesignId)}>
    {#each DESIGNS as option (option.id)}
      <option value={option.id}>{option.label}</option>
    {/each}
  </select>
</label>

<style>
  .design-picker {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 10px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.8125rem;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
  }

  select {
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px 8px;
  }
</style>
