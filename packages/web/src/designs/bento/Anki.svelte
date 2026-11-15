<script lang="ts">
  import { getAnki, getOverview } from "../../lib/api";
  import Chart, { type Theme } from "../../lib/Chart.svelte";
  import { minedTotals, rate } from "../../lib/data";
  import { ORIGIN_LABELS, dayShort, number, percent } from "../../lib/format";
  import Info from "../../lib/Info.svelte";
  import { load } from "../../lib/load.svelte";
  import { FEW_ANSWERS, NOTES } from "../../lib/notes";
  import { baseOption, categoryAxis, donutOption, immersionOption, valueAxis } from "../../lib/vizkit";

  const anki = load(getAnki);
  const recent = load(() => getOverview(16 * 7));
  const origins = $derived(anki.data?.origins ?? []);
  const total = $derived(origins.reduce((sum, origin) => sum + origin.cards, 0));
  const mature = $derived(origins.reduce((sum, origin) => sum + origin.mature, 0));
  const refold = $derived(origins.find((origin) => origin.origin === "refold-1k"));
  const mined = $derived(minedTotals(origins));
  const show = (value: number | null) => (value === null ? "—" : percent.format(value));
  const swatch = (origin: string) => `var(--series-${origin === "refold-1k" ? "refold" : origin})`;
  const themeColor = (theme: Theme, origin: string) =>
    ({ gsm: theme.gsm, youtube: theme.youtube, "refold-1k": theme.refold })[origin] ?? theme.unknown;

  const donut = $derived((theme: Theme) =>
    donutOption(
      theme,
      origins.map((origin) => ({
        name: ORIGIN_LABELS[origin.origin] ?? origin.origin,
        value: origin.cards,
        color: themeColor(theme, origin.origin),
      })),
      (value) => `${number.format(value)} tarjetas`,
      number.format(total),
    ),
  );
  const matured = $derived.by(() => {
    const weeks = anki.data?.weeks ?? [];
    return (theme: Theme) => {
      const base = baseOption(theme, { legend: true });
      const line = (name: string, color: string, values: number[]) => ({
        type: "line",
        name,
        data: values,
        smooth: 0.25,
        showSymbol: false,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        endLabel: { show: true, formatter: "{a}", color: theme.text },
      });
      return {
        ...base,
        grid: { ...base.grid, right: 84 },
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
    immersionOption(theme, recent.data?.days ?? [], { mark: "bars", period: "week", split: "source" }),
  );
</script>

<h1 class="b-title">Anki <Info text={NOTES.origins} label="De dónde sale cada tarjeta" /></h1>

{#if anki.error}
  <p class="error">No se pudo leer Anki: {anki.error}</p>
{:else if !anki.data}
  <p class="muted">Cargando…</p>
{:else}
  <div class="b-grid">
    <div class="b-cell s-3">
      <p class="b-q">¿Cuántas tarjetas tengo?</p>
      <span class="b-big">{number.format(total)}</span>
      <span class="b-sub">{number.format(mined.cards)} minadas</span>
    </div>
    <div class="b-cell s-3">
      <p class="b-q">¿Cuántas ya son maduras? <Info text={NOTES.mature} /></p>
      <span class="b-big">{number.format(mature)}</span>
      <span class="b-sub">{number.format(mined.mature)} minadas</span>
    </div>
    <div class="b-cell s-3">
      <p class="b-q">¿Retengo Refold? <Info text={NOTES.retention(FEW_ANSWERS)} /></p>
      <span class="b-big">{show(refold ? rate(refold.young) : null)}</span>
      <span class="b-sub">jóvenes · maduras {show(refold ? rate(refold.matureRetention) : null)}</span>
    </div>
    <div class="b-cell s-3" class:dim={mined.young.reviews < FEW_ANSWERS}>
      <p class="b-q">¿Y lo que mino?</p>
      <span class="b-big">{show(rate(mined.young))}</span>
      <span class="b-sub">{number.format(mined.young.reviews)} respuestas</span>
    </div>

    <div class="b-cell s-5">
      <p class="b-q">¿De dónde salen?</p>
      <Chart option={donut} height={180} label="Tarjetas por origen" />
      <ul class="b-list">
        {#each origins as origin (origin.origin)}
          <li>
            <i style:background={swatch(origin.origin)}></i><span class="b-name"
              >{ORIGIN_LABELS[origin.origin] ?? origin.origin}</span
            >
            <b>{number.format(origin.cards)}</b>
            <span class:dim={origin.young.reviews < FEW_ANSWERS}>{show(rate(origin.young))}</span>
          </li>
        {/each}
      </ul>
    </div>
    <div class="b-cell s-7">
      <p class="b-q">¿Cuántas llegaron a maduras? <Info text={NOTES.matured} /></p>
      <Chart option={matured} height={280} label="Tarjetas que llegaron a maduras, acumulado por semana" />
    </div>
    <div class="b-cell s-12">
      <p class="b-q">¿Cuánta inmersión hay detrás?</p>
      <Chart option={weekly} height={200} label="Horas de inmersión por semana, por fuente" />
    </div>
  </div>
{/if}

<style>
  .b-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px;
    font-size: 1.75rem;
  }

  .dim .b-big,
  span.dim {
    color: var(--muted);
  }

  .b-list {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 0.875rem;
  }

  .b-list li {
    display: grid;
    grid-template-columns: auto 1fr auto 44px;
    align-items: center;
    gap: 8px;
  }

  .b-list i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .b-list b,
  .b-list span:not(.b-name) {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
