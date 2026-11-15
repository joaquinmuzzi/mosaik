<script lang="ts">
  import { getOverview } from "../../lib/api";
  import Chart, { type Theme } from "../../lib/Chart.svelte";
  import { immersion } from "../../lib/data";
  import { duration, number } from "../../lib/format";
  import Info from "../../lib/Info.svelte";
  import { load } from "../../lib/load.svelte";
  import { NOTES } from "../../lib/notes";
  import { hrefDay } from "../../lib/router.svelte";
  import { immersionOption } from "../../lib/vizkit";

  const overview = load(() => getOverview(30));
  const days = $derived(overview.data?.days ?? []);
  const today = $derived(days.at(-1));
  const week = $derived(days.slice(-7).reduce((sum, day) => sum + immersion(day), 0));

  const chart = $derived((theme: Theme) => {
    const option = immersionOption(theme, days, {
      mark: "bars",
      period: "day",
      split: "source",
      legend: false,
    });
    // No grid, no y axis: the tooltip has the numbers
    return {
      ...option,
      grid: { left: 0, right: 0, top: 8, bottom: 0, containLabel: true },
      yAxis: { type: "value", show: false },
      xAxis: {
        ...option.xAxis,
        axisLabel: {
          color: theme.muted,
          interval: (index: number) => index === 0 || index === days.length - 1,
        },
      },
    };
  });
  const open = (index: number) => {
    const day = days[index];
    if (day) location.hash = hrefDay(day.day);
  };
</script>

{#if overview.error}
  <p class="error">No se pudo leer el resumen: {overview.error}</p>
{:else if !overview.data || !today}
  <p class="muted">Cargando…</p>
{:else}
  <section class="m-hero">
    <p class="m-eyebrow">Hoy <Info text={`${NOTES.immersion} ${NOTES.day(overview.data.cutoffHour)}`} /></p>
    <a class="m-big" href={hrefDay(today.day)}>{duration(immersion(today))}</a>
    <p class="m-split">
      <span><i style:background="var(--series-gsm)"></i>{duration(today.gsmSeconds)} leyendo</span>
      <span
        ><i style:background="var(--series-youtube)"></i>{duration(today.deuchanSeconds ?? 0)} de video</span
      >
    </p>
  </section>

  <section class="m-row" aria-label="Resumen">
    <div>
      <span class="m-num">{duration(week)}</span>
      <span class="m-cap">esta semana</span>
    </div>
    <div>
      <span class="m-num">{overview.data.streak}</span>
      <span class="m-cap"
        >{overview.data.streak === 1 ? "día" : "días"} de racha <Info text={NOTES.streak} /></span
      >
    </div>
    <div>
      <span class="m-num">{number.format(today.reviews)}</span>
      <span class="m-cap">repasos hoy <Info text={NOTES.reviews} /></span>
    </div>
    <div>
      <span class="m-num">{number.format(today.cardsMined)}</span>
      <span class="m-cap">tarjetas minadas <Info text={NOTES.mined} /></span>
    </div>
  </section>

  <section class="card">
    <h2>Últimos 30 días</h2>
    <Chart
      option={chart}
      onselect={open}
      height={170}
      label="Minutos de inmersión por día, lectura y video"
    />
    <p class="m-legend">
      <span><i style:background="var(--series-gsm)"></i>Juegos</span>
      <span><i style:background="var(--series-youtube)"></i>YouTube</span>
    </p>
  </section>
{/if}

<style>
  .m-hero {
    margin-bottom: 56px;
  }

  .m-eyebrow,
  .m-cap {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--muted);
    font-size: 0.8125rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .m-cap {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.9375rem;
  }

  .m-big {
    display: block;
    margin: 6px 0 10px;
    color: var(--text);
    font-size: clamp(3.5rem, 11vw, 6.5rem);
    font-weight: 300;
    letter-spacing: -0.04em;
    line-height: 1;
    text-decoration: none;
    font-variant-numeric: tabular-nums;
  }

  .m-split,
  .m-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin: 0;
    color: var(--muted);
  }

  .m-split i,
  .m-legend i {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 8px;
    border-radius: 50%;
  }

  .m-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 32px;
    margin-bottom: 64px;
  }

  .m-row div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .m-num {
    font-size: 2.25rem;
    font-weight: 300;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .m-legend {
    margin-top: 12px;
    font-size: 0.8125rem;
  }
</style>
