<script lang="ts">
  import type { DaySummary } from "@mosaik/shared";
  import { getContents, getOverview } from "../lib/api";
  import Chart, { type Theme } from "../lib/Chart.svelte";
  import { type FeedItem, type TitleSeries, immersion, loadFeed, loadTitleSeries } from "../lib/data";
  import { dayShort, duration, number } from "../lib/format";
  import Info from "../lib/Info.svelte";
  import { load } from "../lib/load.svelte";
  import { NOTES } from "../lib/notes";
  import { hrefDay } from "../lib/router.svelte";
  import Toggle from "../lib/Toggle.svelte";
  import {
    type Mark,
    type Period,
    type Split,
    donutOption,
    heatmapOption,
    immersionOption,
  } from "../lib/vizkit";

  const year = load(() => getOverview(365));
  let feed = $state<FeedItem[] | null>(null);
  let titles = $state<TitleSeries[] | null>(null);

  let mark = $state<Mark>("bars");
  let period = $state<Period>("day");
  let split = $state<Split>("source");

  $effect(() => {
    if (year.data && !feed) void loadFeed(year.data.days).then((items) => (feed = items));
  });
  $effect(() => {
    if (split === "title" && !titles)
      void getContents()
        .then((r) => loadTitleSeries(r.contents))
        .then((t) => (titles = t));
  });

  const days = $derived(year.data?.days ?? []);
  const today = $derived(days.at(-1));
  const last = (n: number, from = 0) => days.slice(days.length - n - from, days.length - from);
  const total = (list: DaySummary[]) => list.reduce((sum, day) => sum + immersion(day), 0);
  const week = $derived(total(last(7)));
  const previousWeek = $derived(total(last(7, 7)));
  const yearTotal = $derived(total(days));
  const month = $derived(last(30));
  const monthGsm = $derived(month.reduce((sum, day) => sum + day.gsmSeconds, 0));
  const monthYoutube = $derived(month.reduce((sum, day) => sum + (day.deuchanSeconds ?? 0), 0));

  const heat = $derived((theme: Theme) => heatmapOption(theme, days));
  const donut = $derived((theme: Theme) =>
    donutOption(
      theme,
      [
        { name: "Juegos (GSM)", value: monthGsm, color: theme.gsm },
        { name: "YouTube (Deuchan)", value: monthYoutube, color: theme.youtube },
      ],
      duration,
      duration(monthGsm + monthYoutube),
    ),
  );
  const chartDays = $derived(period === "day" ? last(30) : last(16 * 7));
  const main = $derived((theme: Theme) =>
    immersionOption(theme, chartDays, { mark, period, split, titles: titles ?? [] }),
  );

  const kindLabel = { gsm: "Juego", youtube: "Video", mined: "Anki" } as const;
</script>

{#if year.error}
  <p class="error">No se pudo leer el resumen: {year.error}</p>
{:else if !year.data || !today}
  <p class="muted">Cargando…</p>
{:else}
  <header class="k-head">
    <h1>Panel</h1>
    <Info text={NOTES.day(year.data.cutoffHour)} label="Cómo se cuentan los días" />
  </header>

  <section class="k-stats" aria-label="Resumen">
    <a class="k-stat" href={hrefDay(today.day)}>
      <span class="k-label">Hoy <Info text={NOTES.immersion} /></span>
      <span class="k-value">{duration(immersion(today))}</span>
      <span class="k-split">
        <i style:background="var(--series-gsm)"></i>{duration(today.gsmSeconds)} juego
        <i style:background="var(--series-youtube)"></i>{duration(today.deuchanSeconds ?? 0)} video
      </span>
    </a>
    <div class="k-stat">
      <span class="k-label">Esta semana</span>
      <span class="k-value">{duration(week)}</span>
      <span class="k-split">semana anterior {duration(previousWeek)}</span>
    </div>
    <div class="k-stat">
      <span class="k-label">Racha <Info text={NOTES.streak} /></span>
      <span class="k-value">{year.data.streak} <small>{year.data.streak === 1 ? "día" : "días"}</small></span>
    </div>
    <div class="k-stat">
      <span class="k-label">Anki hoy <Info text={NOTES.reviews} /></span>
      <span class="k-value">{number.format(today.reviews)} <small>repasos</small></span>
      <span class="k-split">{number.format(today.cardsMined)} minadas</span>
    </div>
    <div class="k-stat">
      <span class="k-label">Año <Info text={NOTES.year} /></span>
      <span class="k-value">{duration(yearTotal)}</span>
    </div>
  </section>

  <section class="card k-heat">
    <h2>Actividad del año</h2>
    <Chart option={heat} height={150} label="Mapa de calor de la inmersión diaria del último año" />
  </section>

  <div class="k-row">
    <section class="card k-donut">
      <h2>Últimos 30 días</h2>
      <Chart
        option={donut}
        height={190}
        label="Distribución de la inmersión de los últimos 30 días por fuente"
      />
      <ul class="k-legend">
        <li><i style:background="var(--series-gsm)"></i>Juegos <b>{duration(monthGsm)}</b></li>
        <li><i style:background="var(--series-youtube)"></i>YouTube <b>{duration(monthYoutube)}</b></li>
      </ul>
    </section>

    <section class="card k-main-chart">
      <div class="k-chart-head">
        <h2>Inmersión</h2>
        <div class="k-switches">
          <Toggle
            label="Tipo de gráfico"
            options={[
              ["bars", "Barras"],
              ["lines", "Líneas"],
            ] as const}
            bind:value={mark}
          />
          <Toggle
            label="Período"
            options={[
              ["day", "Día"],
              ["week", "Semana"],
            ] as const}
            bind:value={period}
          />
          <Toggle
            label="Agrupar"
            options={[
              ["source", "Fuente"],
              ["title", "Título"],
            ] as const}
            bind:value={split}
          />
        </div>
      </div>
      {#key `${split}-${titles ? 1 : 0}`}
        <Chart option={main} height={250} label="Inmersión por período" />
      {/key}
    </section>
  </div>

  <section class="card">
    <h2>Actividad reciente</h2>
    {#if !feed}
      <p class="muted">Cargando…</p>
    {:else if feed.length === 0}
      <p class="muted">Nada todavía.</p>
    {:else}
      <ul class="k-feed">
        {#each feed as item (item.key)}
          <li>
            <span class="k-kind {item.kind}">{kindLabel[item.kind]}</span>
            <span class="k-feed-text"><b>{item.title}</b><span>{item.detail}</span></span>
            <a class="k-feed-day" href={hrefDay(item.day)}>{dayShort(item.day)}</a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .k-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  h2 {
    font-size: 0.8125rem !important;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .k-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  .k-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }

  a.k-stat:hover {
    background: var(--surface-2);
  }

  .k-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .k-value {
    font-size: 1.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }

  .k-value small {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--muted);
  }

  .k-split {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .k-split i,
  .k-legend i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .k-row {
    display: grid;
    grid-template-columns: minmax(240px, 1fr) 2.4fr;
    gap: 16px;
  }

  .k-legend {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: grid;
    gap: 4px;
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .k-legend li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .k-legend b {
    margin-left: auto;
    color: var(--text);
  }

  .k-chart-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .k-switches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .k-feed {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .k-feed li {
    display: grid;
    grid-template-columns: 64px 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .k-feed li:last-child {
    border-bottom: 0;
  }

  .k-kind {
    justify-self: start;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    /* Dark text: white on these mid-tone colors would fall under 4.5:1 */
    color: #120d1a;
    background: var(--series-gsm);
  }

  .k-kind.youtube {
    background: var(--series-youtube);
  }

  .k-kind.mined {
    background: var(--series-mined);
  }

  .k-feed-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .k-feed-text b {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .k-feed-text span {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .k-feed-day {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  @media (max-width: 1000px) {
    .k-row {
      grid-template-columns: 1fr;
    }
  }
</style>
