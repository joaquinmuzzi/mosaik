<script lang="ts">
  /**
   * The immersion of each day as Anki's Review Heatmap shows reviews: square cells, Monday first, month
   * names below, blue from dark to light, and the figures of the whole history under it. Each day opens
   * its page. It shows as many months as fit (12 at most); the buttons move to older ones.
   */
  import { onMount } from "svelte";
  import { LEVELS, activityFacts, activityLevel, addMonths, fitCalendar, monthsBetween } from "./calendar";
  import { dayLong, duration, percent } from "./format";
  import { hrefDay } from "./router.svelte";

  /** In order, one entry per day, ending today. */
  let { days }: { days: { day: string; seconds: number }[] } = $props();

  const LABELS = 22;
  const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  let root: HTMLDivElement;
  let width = $state(0);
  let touch = $state(false);
  /** How many months back the last one shown is. */
  let back = $state(0);
  let hovered = $state<{ text: string; x: number; y: number } | null>(null);

  const today = $derived(days.at(-1)?.day ?? "");
  const seconds = $derived(new Map(days.map((day) => [day.day, day.seconds])));
  const facts = $derived(activityFacts(days));
  const firstMonth = $derived((days.find((day) => day.seconds > 0)?.day ?? today).slice(0, 7));
  const thisMonth = $derived(today.slice(0, 7));

  // A finger needs a larger cell than a mouse
  const view = $derived(
    fitCalendar(addMonths(thisMonth, -back), Math.max(0, width - LABELS), {
      first: firstMonth,
      minPitch: touch ? 14 : 12,
    }),
  );
  const gap = $derived(view.pitch >= 14 ? 3 : 2);
  const oldest = $derived(view.months[0]?.month ?? thisMonth);
  const canGoBack = $derived(monthsBetween(firstMonth, oldest) > 0);

  function move(direction: 1 | -1) {
    const shown = view.months.length;
    // The first month with something is never left behind on the way back
    const step = direction === 1 ? Math.min(shown, monthsBetween(firstMonth, oldest)) : -shown;
    back = Math.max(0, back + step);
    hovered = null;
  }

  const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} '${month.slice(2, 4)}`;
  const describe = (day: string) => {
    const value = seconds.get(day) ?? 0;
    return `${value > 0 ? duration(value) : day > today ? "Todavía no llegó" : "Sin inmersión"} · ${dayLong(day)}`;
  };

  function show(event: Event, day: string) {
    const cell = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    hovered = { text: describe(day), x: cell.left + cell.width / 2 - box.left, y: cell.top - box.top };
  }

  onMount(() => {
    const observer = new ResizeObserver(() => (width = root.clientWidth));
    observer.observe(root);
    width = root.clientWidth;
    touch = window.matchMedia("(pointer: coarse)").matches;
    return () => observer.disconnect();
  });

  const strength = (day: string) => activityLevel(seconds.get(day) ?? 0, facts.activeAverage) / LEVELS;
</script>

<div class="calendar" bind:this={root} style:--pitch={`${view.pitch}px`} style:--gap={`${gap}px`}>
  <div class="nav" role="group" aria-label="Moverse por los meses">
    <button type="button" onclick={() => move(1)} disabled={!canGoBack} aria-label="Meses anteriores">
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M8 2 4 6l4 4" /></svg>
    </button>
    <button type="button" onclick={() => (back = 0)} disabled={back === 0} aria-label="Volver a hoy">
      <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.5" /></svg>
    </button>
    <button type="button" onclick={() => move(-1)} disabled={back === 0} aria-label="Meses siguientes">
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4" /></svg>
    </button>
  </div>

  {#if width > 0}
    <div class="months">
      <div class="weekdays" aria-hidden="true">
        {#each WEEKDAYS as label, index (index)}<span>{label}</span>{/each}
      </div>
      {#each view.months as month (month.month)}
        <div class="month">
          <div class="weeks">
            {#each month.weeks as week, index (index)}
              {#each week as cell, row (row)}
                {#if cell && cell.day <= today}
                  <a
                    class="cell"
                    class:active={strength(cell.day) > 0}
                    class:today={cell.day === today}
                    style:--strength={strength(cell.day)}
                    href={hrefDay(cell.day)}
                    tabindex={cell.day === today ? 0 : -1}
                    aria-label={describe(cell.day)}
                    onmouseenter={(event) => show(event, cell.day)}
                    onmouseleave={() => (hovered = null)}
                    onfocus={(event) => show(event, cell.day)}
                    onblur={() => (hovered = null)}
                  ></a>
                {:else if cell}
                  <span class="cell future" aria-hidden="true"></span>
                {:else}
                  <span aria-hidden="true"></span>
                {/if}
              {/each}
            {/each}
          </div>
          <span class="name">{monthName(month.month)}</span>
        </div>
      {/each}
    </div>
  {/if}

  <dl class="facts">
    <div>
      <dt>Promedio por día:</dt>
      <dd>{duration(facts.average)}</dd>
    </div>
    <div>
      <dt>Días con inmersión:</dt>
      <dd>{percent.format(facts.activeShare)}</dd>
    </div>
    <div>
      <dt>Racha más larga:</dt>
      <dd>{facts.longest} {facts.longest === 1 ? "día" : "días"}</dd>
    </div>
    <div>
      <dt>Racha actual:</dt>
      <dd>{facts.current} {facts.current === 1 ? "día" : "días"}</dd>
    </div>
  </dl>

  {#if hovered}
    <div
      class="tip"
      role="presentation"
      style:left={`${Math.min(Math.max(hovered.x, 110), Math.max(110, width - 110))}px`}
      style:top={`${hovered.y - 6}px`}
    >
      {hovered.text}
    </div>
  {/if}
</div>

<style>
  .calendar {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .nav {
    display: flex;
    gap: 4px;
  }

  .nav button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-2);
    color: var(--secondary);
    cursor: pointer;
  }

  .nav button:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-strong);
  }

  .nav button:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .nav svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .months {
    display: flex;
    max-width: 100%;
    /* The blank column between two months */
    gap: var(--pitch);
  }

  .weekdays,
  .weeks {
    display: grid;
    grid-template-rows: repeat(7, var(--pitch));
  }

  .weekdays {
    /* The labels sit in the column the months leave blank */
    width: 22px;
    margin-right: calc(-1 * var(--pitch));
    align-items: center;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1;
    color: var(--muted);
  }

  .weeks {
    grid-auto-flow: column;
    grid-auto-columns: var(--pitch);
  }

  .weeks > * {
    width: calc(var(--pitch) - var(--gap));
    height: calc(var(--pitch) - var(--gap));
    align-self: center;
    justify-self: center;
  }

  .cell {
    border-radius: 2px;
    background: var(--heat-empty);
  }

  .cell.active {
    background: color-mix(in oklab, var(--heat-high) calc(var(--strength) * 100%), var(--heat-low));
  }

  .cell.future {
    opacity: 0.6;
  }

  a.cell:hover {
    outline: 1px solid var(--text);
  }

  .cell.today {
    outline: 1.5px solid var(--secondary);
    outline-offset: 0;
  }

  .name {
    display: block;
    margin-top: 6px;
    text-align: center;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  .facts {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 24px;
    font-size: 0.9286rem;
  }

  .facts div {
    display: flex;
    gap: 6px;
  }

  .facts dt {
    color: var(--muted);
  }

  .facts dd {
    margin: 0;
    color: var(--heat-high);
    font-variant-numeric: tabular-nums;
  }

  .tip {
    position: absolute;
    z-index: 5;
    transform: translate(-50%, -100%);
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 0.8571rem;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
