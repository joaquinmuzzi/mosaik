<script lang="ts">
  /** Shows the chosen design. Every design reads the same API and keeps the same routes. */
  import Actual from "./designs/actual/Shell.svelte";
  import Bento from "./designs/bento/Shell.svelte";
  import Kechimochi from "./designs/kechimochi/Shell.svelte";
  import Minimal from "./designs/minimal/Shell.svelte";
  import Spielstand from "./designs/spielstand/Shell.svelte";
  import DesignPicker from "./lib/DesignPicker.svelte";
  import { design } from "./lib/design.svelte";

  const shells = {
    actual: Actual,
    kechimochi: Kechimochi,
    minimal: Minimal,
    bento: Bento,
    spielstand: Spielstand,
  };
  const Shell = $derived(shells[design.id]);
</script>

{#key design.id}
  <Shell />
{/key}
<DesignPicker />
