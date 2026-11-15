<script lang="ts">
  import { getAnki, getOverview } from "../lib/api";
  import Chart, { type Theme } from "../lib/Chart.svelte";
  import { minedTotals, rate } from "../lib/data";
  import { ORIGIN_LABELS, dayShort, number, percent } from "../lib/format";
  import Info from "../lib/Info.svelte";
  import { load } from "../lib/load.svelte";
  import { FEW_ANSWERS, NOTES } from "../lib/notes";
  import { baseOption, categoryAxis, donutOption, immersionOption, valueAxis } from "../lib/vizkit";

  const anki = load(getAnki);
  const year = load(() => getOverview(16 * 7));

  const color: Record<string, string> = {
    gsm: "var(--series-gsm)",
    youtube: "var(--series-youtube)",
    "refold-1k": "var(--series-refold)",
    unknown: "var(--series-unknown)",
  };
  const themeColor = (theme: Theme, origin: string) =>
    ({ gsm: theme.gsm, youtube: theme.youtube, "refold-1k": theme.refold })[origin] ?? theme.unknown;

  const origins = $derived(anki.data?.origins ?? []);
  const totalCards = $derived(origins.reduce((sum, origin) => sum + origin.cards, 0));
  const totalMature = $derived(origins.reduce((sum, origin) => sum + origin.mature, 0));
  const refold = $derived(origins.find((origin) => origin.origin === "refold-1k"));
  const mined = $derived(minedTotals(origins));

  const show = (value: number | null) => (value === null ? "—" : percent.format(value));

  const donut = $derived((theme: Theme) =>
    donutOption(
      theme,
      origins.map((origin) => ({
        name: ORIGIN_LABELS[origin.origin] ?? origin.origin,
        value: origin.cards,
        color: themeColor(theme, origin.origin),
      })),
      (value) => `${number.format(value)} tarjetas`,
      number.format(totalCards),
    ),
  );

  const matured = $derived.by(() => {
    const weeks = anki.data?.weeks ?? [];
    return (theme: Theme) => {
      const base = baseOption(theme, { legend: true });
      const line = (name: string, colorValue: string, values: number[]) => ({
        type: "line",
        name,
        data: values,
        smooth: 0.25,
        showSymbol: false,
        lineStyle: { width: 2, color: colorValue },
        itemStyle: { color: colorValue },
        areaStyle: { color: colorValue, opacity: 0.08 },
        endLabel: { show: true, formatter: "{a}", color: theme.text },
      });
      return {
        ...base,
        grid: { ...base.grid, right: 90 },
        tooltip: { ...base.tooltip, axisPointer: { type: "line", lineStyle: { color: theme.muted } } },
        xAxis: {
          ...categoryAxis(
            theme,
            weeks.map((week) => dayShort(week.week)),
          ),
          boundaryGap: false,
        },
        yAxis: valueAxis(theme, "tarjetas"),
        series: [
          line(
            "Refold 1k",
            theme.refold,
            weeks.map((week) => week.maturedRefold),
          ),
          line(
            "Minadas",
            theme.mined,
            weeks.map((week) => week.maturedMined),
          ),
        ],
      };
    };
  });

  const weekly = $derived((theme: Theme) =>
    immersionOption(theme, year.data?.days ?? [], { mark: "bars", period: "week", split: "source" }),
  );
</script>

<header class="k-head">
  <h1>Anki</h1>
  <Info text={NOTES.origins} label="De dónde sale cada tarjeta" />
</header>

{#if anki.error}
  <p class="error">No se pudo leer Anki: {anki.error}</p>
{:else if !anki.data}
  <p class="muted">Cargando…</p>
{:else}
  <section class="k-stats" aria-label="Resumen de Anki">
    <div class="k-stat">
      <span class="k-label">Tarjetas</span>
      <span class="k-value">{number.format(totalCards)}</span>
      <span class="k-sub">{number.format(mined.cards)} minadas</span>
    </div>
    <div class="k-stat">
      <span class="k-label">Maduras <Info text={NOTES.mature} /></span>
      <span class="k-value">{number.format(totalMature)}</span>
      <span class="k-sub">{number.format(mined.mature)} minadas</span>
    </div>
    <div class="k-stat">
      <span class="k-label">Retención Refold <Info text={NOTES.retention(FEW_ANSWERS)} /></span>
      <span class="k-value">{show(refold ? rate(refold.young) : null)}</span>
      <span class="k-sub">jóvenes · maduras {show(refold ? rate(refold.matureRetention) : null)}</span>
    </div>
    <div class="k-stat" class:dim={mined.young.reviews < FEW_ANSWERS}>
      <span class="k-label">Retención minadas <Info text={NOTES.retention(FEW_ANSWERS)} /></span>
      <span class="k-value">{show(rate(mined.young))}</span>
      <span class="k-sub">{number.format(mined.young.reviews)} respuestas</span>
    </div>
  </section>

  <div class="k-row">
    <section class="card">
      <h2>Por origen</h2>
      <Chart option={donut} height={200} label="Tarjetas por origen" />
      <ul class="k-origins">
        {#each origins as origin (origin.origin)}
          <li>
            <i style:background={color[origin.origin]}></i>
            <span>{ORIGIN_LABELS[origin.origin] ?? origin.origin}</span>
            <b>{number.format(origin.cards)}</b>
            <span class="k-ret" class:dim={origin.young.reviews < FEW_ANSWERS}
              >{show(rate(origin.young))}</span
            >
          </li>
        {/each}
      </ul>
    </section>
    <section class="card">
      <h2>Llegaron a maduras <Info text={NOTES.matured} /></h2>
      <Chart option={matured} height={280} label="Tarjetas que llegaron a maduras, acumulado por semana" />
    </section>
  </div>

  <section class="card">
    <h2>Inmersión por semana</h2>
    <Chart option={weekly} height={220} label="Horas de inmersión por semana, por fuente" />
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
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8125rem !important;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .k-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
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
  }

  .k-sub {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .dim .k-value,
  .k-ret.dim {
    color: var(--muted);
  }

  .k-row {
    display: grid;
    grid-template-columns: minmax(260px, 1fr) 2fr;
    gap: 16px;
  }

  .k-origins {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 0.875rem;
  }

  .k-origins li {
    display: grid;
    grid-template-columns: 10px 1fr auto 48px;
    align-items: center;
    gap: 8px;
  }

  .k-origins i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .k-origins b {
    font-variant-numeric: tabular-nums;
  }

  .k-ret {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 1000px) {
    .k-row {
      grid-template-columns: 1fr;
    }
  }
</style>
