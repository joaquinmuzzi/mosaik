<script lang="ts">
  import type { DaySummary } from "@mosaik/shared";
  import { getContents, getOverview } from "../lib/api";
  import Chart, { type Theme } from "../lib/Chart.svelte";
  import { type FeedItem, type TitleSeries, immersion, loadFeed, loadTitleSeries } from "../lib/data";
  import { dayLong, dayShort, duration, number, percent } from "../lib/format";
  import Info from "../lib/Info.svelte";
  import { load } from "../lib/load.svelte";
  import { NOTES } from "../lib/notes";
  import { hrefDay } from "../lib/router.svelte";
  import Toggle from "../lib/Toggle.svelte";
  import { type Mark, type Period, type Split, heatmapOption, immersionOption } from "../lib/vizkit";

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
  const weekChange = $derived(week - previousWeek);
  const yearTotal = $derived(total(days));
  const month = $derived(last(30));
  const monthGsm = $derived(month.reduce((sum, day) => sum + day.gsmSeconds, 0));
  const monthYoutube = $derived(month.reduce((sum, day) => sum + (day.deuchanSeconds ?? 0), 0));
  const monthTotal = $derived(monthGsm + monthYoutube);
  const monthReviews = $derived(month.reduce((sum, day) => sum + day.reviews, 0));
  const monthMined = $derived(month.reduce((sum, day) => sum + day.cardsMined, 0));
  const share = (value: number) => (monthTotal > 0 ? value / monthTotal : 0);

  const heat = $derived((theme: Theme) => heatmapOption(theme, days, { cell: 16 }));
  const chartDays = $derived(period === "day" ? last(30) : last(16 * 7));
  const main = $derived((theme: Theme) =>
    immersionOption(theme, chartDays, { mark, period, split, titles: titles ?? [] }),
  );

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
      <span class="k-value figure">{duration(week)}</span>
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
      <h2>Último año</h2>
      <span class="meta">{duration(yearTotal)} en 365 días <Info text={NOTES.year} /></span>
    </div>
    <Chart option={heat} height={180} label="Mapa de calor de la inmersión diaria del último año" />
  </section>

  <div class="k-row">
    <section class="card">
      <div class="k-card-head">
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
        <Chart option={main} height={300} label="Inmersión por período" />
      {/key}
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
            ><span class="tile" style:background="var(--series-youtube)"></span>YouTube</span
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
            <span class="tile" style:background={kindColor[item.kind]} aria-hidden="true"></span>
            <span class="k-feed-text">
              <span class="k-feed-title">{item.title}</span>
              <span class="k-feed-detail">{item.detail}</span>
            </span>
            <a class="meta k-feed-day" href={hrefDay(item.day)}>{dayShort(item.day)}</a>
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

  .k-feed li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    border-bottom: 1px solid var(--border);
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
