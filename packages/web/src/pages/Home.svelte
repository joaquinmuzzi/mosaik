<script lang="ts">
  import type { DaySummary } from "@mosaik/shared";
  import { getContents, getOverview, getStats } from "../lib/api";
  import ActivityCalendar from "../lib/ActivityCalendar.svelte";
  import Chart, { type Theme, readTheme } from "../lib/Chart.svelte";
  import {
    type FeedItem,
    type TitleSeries,
    immersion,
    loadFeed,
    loadTitleSeries,
    mondayOf,
    weekKeys,
  } from "../lib/data";
  import { dayLong, dayShort, duration, number, percent } from "../lib/format";
  import Info from "../lib/Info.svelte";
  import { load } from "../lib/load.svelte";
  import { NOTES } from "../lib/notes";
  import { hrefContent, hrefContents, hrefDay } from "../lib/router.svelte";
  import Toggle from "../lib/Toggle.svelte";
  import { type Mark, type Period, type Split, immersionOption, titleColor } from "../lib/vizkit";

  const year = load(() => getOverview(365));
  // The whole history, for the calendar; until it is here, the last year
  const stats = load(getStats);
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
  const weekTotal = $derived(total(last(7)));
  const previousWeek = $derived(total(last(7, 7)));
  const weekChange = $derived(weekTotal - previousWeek);
  const yearTotal = $derived(total(days));
  const month = $derived(last(30));
  const monthGsm = $derived(month.reduce((sum, day) => sum + day.gsmSeconds, 0));
  const monthYoutube = $derived(month.reduce((sum, day) => sum + (day.deuchanSeconds ?? 0), 0));
  const monthTotal = $derived(monthGsm + monthYoutube);
  const monthReviews = $derived(month.reduce((sum, day) => sum + day.reviews, 0));
  const monthMined = $derived(month.reduce((sum, day) => sum + day.cardsMined, 0));
  const share = (value: number) => (monthTotal > 0 ? value / monthTotal : 0);

  const calendarDays = $derived(
    (stats.data?.days.length ? stats.data.days : days).map((day) => ({
      day: day.day,
      seconds: immersion(day),
    })),
  );

  // A click on a week shows its days; a click on a day opens it
  let week = $state<string | null>(null);
  const chartDays = $derived(
    period === "week" && week
      ? days.filter((day) => mondayOf(day.day) === week)
      : period === "day"
        ? last(30)
        : last(16 * 7),
  );
  const shownPeriod = $derived<Period>(week ? "day" : period);
  const chartWeeks = $derived(weekKeys(chartDays.map((day) => day.day)));
  function openPeriod(index: number) {
    if (shownPeriod === "week") {
      week = chartWeeks[index] ?? null;
      return;
    }
    const day = chartDays[index];
    if (day) location.hash = hrefDay(day.day);
  }
  $effect(() => {
    if (period === "day") week = null;
  });
  const main = $derived((theme: Theme) =>
    immersionOption(theme, chartDays, {
      mark,
      period: shownPeriod,
      split,
      titles: titles ?? [],
      legend: false,
    }),
  );
  // The legend is a list of links under the chart: long titles do not fit inside it
  const legend = $derived.by(() => {
    const keys = chartDays.map((day) => day.day);
    if (split === "title") {
      const theme = readTheme();
      return (titles ?? []).map((series, index) => ({
        key: series.id,
        name: series.title,
        color: titleColor(theme, series, index),
        seconds: keys.reduce((sum, key) => sum + (series.days.get(key) ?? 0), 0),
        href: hrefContent(series.id),
      }));
    }
    return [
      {
        key: "gsm",
        name: "Juegos (GSM)",
        color: "var(--series-gsm)",
        seconds: chartDays.reduce((sum, day) => sum + day.gsmSeconds, 0),
        href: hrefContents("juegos"),
      },
      {
        key: "deuchan",
        name: "Deuchan",
        color: "var(--series-youtube)",
        seconds: chartDays.reduce((sum, day) => sum + (day.deuchanSeconds ?? 0), 0),
        href: hrefContents("videos"),
      },
    ];
  });

  const kindColor = {
    gsm: "var(--series-gsm)",
    youtube: "var(--series-youtube)",
    mined: "var(--series-mined)",
  } as const;
</script>

{#if year.error}
  <p class="error">No se pudo leer el resumen: {year.error}</p>
{:else if !year.data || !today}
  <p class="muted">Cargando…</p>
{:else}
  <header class="k-head">
    <h1>Panel</h1>
    <span class="meta">{dayLong(today.day)}</span>
    <Info text={NOTES.day(year.data.cutoffHour)} label="Cómo se cuentan los días" />
  </header>

  <section class="k-stats" aria-label="Resumen">
    <a class="k-stat" href={hrefDay(today.day)}>
      <span class="k-label">Hoy <Info text={NOTES.immersion} /></span>
      <span class="k-value figure">{duration(immersion(today))}</span>
      <span class="k-sub">
        <span class="tile" style:background="var(--series-gsm)"></span>{duration(today.gsmSeconds)} de juego
        <span class="tile" style:background="var(--series-youtube)"></span>{duration(
          today.deuchanSeconds ?? 0,
        )} de video
      </span>
    </a>
    <div class="k-stat">
      <span class="k-label">Últimos 7 días</span>
      <span class="k-value figure">{duration(weekTotal)}</span>
      <span class="k-sub" class:up={weekChange > 0}>
        {weekChange === 0 ? "igual" : `${weekChange > 0 ? "+" : "−"}${duration(Math.abs(weekChange))}`} vs los 7
        anteriores
      </span>
    </div>
    <div class="k-stat">
      <span class="k-label">Racha <Info text={NOTES.streak} /></span>
      <span class="k-value figure">{year.data.streak} {year.data.streak === 1 ? "día" : "días"}</span>
      <span class="k-sub">seguidos con inmersión</span>
    </div>
    <div class="k-stat">
      <span class="k-label">Anki hoy <Info text={NOTES.reviews} /></span>
      <span class="k-value figure">{number.format(today.reviews)} repasos</span>
      <span class="k-sub"
        >{number.format(today.cardsMined)} {today.cardsMined === 1 ? "minada" : "minadas"}</span
      >
    </div>
  </section>

  <section class="card k-heat">
    <div class="k-card-head">
      <h2>Actividad</h2>
      <span class="meta">{duration(yearTotal)} en 365 días <Info text={NOTES.year} /></span>
    </div>
    <ActivityCalendar days={calendarDays} />
  </section>

  <div class="k-row">
    <section class="card">
      <div class="k-card-head">
        <h2>
          Inmersión
          {#if week}
            <button type="button" class="k-week" onclick={() => (week = null)}
              >Semana del {dayShort(week)} <span aria-hidden="true">×</span><span class="visually-hidden"
                >Volver a las semanas</span
              ></button
            >
          {/if}
        </h2>
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
        <Chart option={main} onselect={openPeriod} height={280} label="Inmersión por período" />
      {/key}
      <ul class="k-legend" class:titles={split === "title"}>
        {#each legend as item (item.key)}
          <li>
            <a href={item.href} title={item.name}>
              <span class="tile" style:background={item.color} aria-hidden="true"></span>
              <span class="k-legend-name">{item.name}</span>
              <span class="figure k-legend-time">{duration(item.seconds)}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>

    <section class="card">
      <div class="k-card-head">
        <h2>Últimos 30 días</h2>
        <span class="meta">{duration(monthTotal)}</span>
      </div>
      <ul class="k-shares" aria-label="Inmersión de los últimos 30 días por fuente">
        <li>
          <span class="k-share-name"
            ><span class="tile" style:background="var(--series-gsm)"></span>Juegos</span
          >
          <span class="figure">{duration(monthGsm)}</span>
          <span class="k-bar" aria-hidden="true"
            ><i style:width={`${share(monthGsm) * 100}%`} style:background="var(--series-gsm)"></i></span
          >
          <span class="meta">{percent.format(share(monthGsm))}</span>
        </li>
        <li>
          <span class="k-share-name"
            ><span class="tile" style:background="var(--series-youtube)"></span>Deuchan</span
          >
          <span class="figure">{duration(monthYoutube)}</span>
          <span class="k-bar" aria-hidden="true"
            ><i style:width={`${share(monthYoutube) * 100}%`} style:background="var(--series-youtube)"
            ></i></span
          >
          <span class="meta">{percent.format(share(monthYoutube))}</span>
        </li>
      </ul>
      <dl class="k-facts">
        <div>
          <dt>Repasos</dt>
          <dd class="figure">{number.format(monthReviews)}</dd>
        </div>
        <div>
          <dt>Tarjetas minadas</dt>
          <dd class="figure">{number.format(monthMined)}</dd>
        </div>
        <div>
          <dt>Promedio por día</dt>
          <dd class="figure">{duration(monthTotal / 30)}</dd>
        </div>
      </dl>
    </section>
  </div>

  <section class="card">
    <h2>Actividad reciente</h2>
    {#if !feed}
      <p class="muted">Cargando…</p>
    {:else if feed.length === 0}
      <p class="muted">Nada todavía</p>
    {:else}
      <ul class="k-feed">
        {#each feed as item (item.key)}
          <li>
            <a class="k-feed-line" href={item.href}>
              <span class="tile" style:background={kindColor[item.kind]} aria-hidden="true"></span>
              <span class="k-feed-text">
                <span class="k-feed-title">{item.title}</span>
                <span class="k-feed-detail">{item.detail}</span>
              </span>
            </a>
            <a class="meta k-feed-day" href={hrefDay(item.day)} aria-label={`Ver el ${dayShort(item.day)}`}
              >{dayShort(item.day)}</a
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .k-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    line-height: 1.15;
  }

  .k-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }

  .k-stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px 20px;
    border-radius: var(--radius-card);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
    transition: background-color 150ms var(--ease);
  }

  a.k-stat:hover {
    background: var(--surface-2);
  }

  .k-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--secondary);
  }

  .k-value {
    font-size: 2rem;
    font-weight: 500;
    line-height: 1.15;
  }

  .k-sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    color: var(--muted);
    font-size: 0.9286rem;
  }

  .k-sub.up {
    color: var(--positive);
  }

  .k-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    margin-bottom: 12px;
  }

  .k-card-head h2 {
    margin: 0;
  }

  .k-card-head .meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .k-row {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 16px;
  }

  .k-switches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .k-shares {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 16px;
  }

  .k-shares li {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px 12px;
  }

  .k-share-name {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--secondary);
  }

  .k-bar {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .k-bar i {
    display: block;
    height: 100%;
  }

  .k-facts {
    margin: 20px 0 0;
    padding: 16px 0 0;
    border-top: 1px solid var(--border);
    display: grid;
    gap: 8px;
  }

  .k-facts div {
    display: flex;
    justify-content: space-between;
  }

  .k-facts dt {
    color: var(--secondary);
  }

  .k-facts dd {
    margin: 0;
  }

  .k-feed {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .k-week {
    margin-left: 8px;
    padding: 2px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-2);
    color: var(--secondary);
    font: inherit;
    font-size: 0.8571rem;
    cursor: pointer;
  }

  .k-week:hover {
    color: var(--text);
  }

  .k-legend {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0 8px;
  }

  .k-legend.titles {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .k-legend a {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    color: var(--text);
    text-decoration: none;
    transition: background-color 150ms var(--ease);
  }

  .k-legend a:hover {
    background: var(--surface-2);
  }

  .k-legend-name {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .k-legend.titles .k-legend-name {
    flex: 1;
  }

  .k-legend-time {
    flex: none;
    color: var(--muted);
  }

  .k-feed li {
    display: flex;
    align-items: stretch;
    min-height: 40px;
    border-bottom: 1px solid var(--border);
  }

  .k-feed-line {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 8px;
    margin-left: -8px;
    border-radius: var(--radius-control);
    color: var(--text);
    text-decoration: none;
    transition: background-color 150ms var(--ease);
  }

  .k-feed-line:hover {
    background: var(--surface-2);
  }

  .k-feed li:last-child {
    border-bottom: 0;
  }

  .k-feed-text {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .k-feed-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .k-feed-detail {
    flex: none;
    color: var(--muted);
  }

  .k-feed-day {
    flex: none;
    display: flex;
    align-items: center;
    padding-left: 12px;
    text-decoration: none;
  }

  .k-feed-day:hover {
    color: var(--text);
  }

  @media (max-width: 1100px) {
    .k-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .k-row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
