<script lang="ts">
  import { getAnki } from "../../lib/api";
  import Chart, { type Theme } from "../../lib/Chart.svelte";
  import { minedTotals, rate } from "../../lib/data";
  import { ORIGIN_LABELS, dayShort, number, percent } from "../../lib/format";
  import Info from "../../lib/Info.svelte";
  import { load } from "../../lib/load.svelte";
  import { FEW_ANSWERS, NOTES } from "../../lib/notes";
  import { categoryAxis } from "../../lib/vizkit";

  const anki = load(getAnki);
  const origins = $derived(anki.data?.origins ?? []);
  const total = $derived(origins.reduce((sum, origin) => sum + origin.cards, 0));
  const mature = $derived(origins.reduce((sum, origin) => sum + origin.mature, 0));
  const refold = $derived(origins.find((origin) => origin.origin === "refold-1k"));
  const mined = $derived(minedTotals(origins));
  const show = (value: number | null) => (value === null ? "—" : percent.format(value));
  const color: Record<string, string> = {
    gsm: "var(--series-gsm)",
    youtube: "var(--series-youtube)",
    "refold-1k": "var(--series-refold)",
    unknown: "var(--series-unknown)",
  };

  const chart = $derived.by(() => {
    const weeks = anki.data?.weeks ?? [];
    return (theme: Theme) => {
      const line = (name: string, value: string, values: number[]) => ({
        type: "line",
        name,
        data: values,
        smooth: 0.3,
        showSymbol: false,
        lineStyle: { width: 2, color: value },
        itemStyle: { color: value },
        endLabel: { show: true, formatter: "{a}  {c}", color: theme.text },
      });
      return {
        animation: false,
        textStyle: { color: theme.muted },
        grid: { left: 0, right: 110, top: 10, bottom: 0, containLabel: true },
        tooltip: {
          trigger: "axis",
          backgroundColor: theme.surface,
          borderColor: theme.grid,
          textStyle: { color: theme.text },
          axisPointer: { type: "line", lineStyle: { color: theme.grid } },
        },
        xAxis: {
          ...categoryAxis(
            theme,
            weeks.map((week) => dayShort(week.week)),
          ),
          boundaryGap: false,
          axisLabel: {
            color: theme.muted,
            interval: (index: number) => index === 0 || index === weeks.length - 1,
          },
        },
        yAxis: { type: "value", show: false },
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
</script>

<h1 class="m-title">Anki <Info text={NOTES.origins} label="De dónde sale cada tarjeta" /></h1>

{#if anki.error}
  <p class="error">No se pudo leer Anki: {anki.error}</p>
{:else if !anki.data}
  <p class="muted">Cargando…</p>
{:else}
  <section class="m-row" aria-label="Resumen de Anki">
    <div><span class="m-num">{number.format(total)}</span><span class="m-cap">tarjetas</span></div>
    <div>
      <span class="m-num">{number.format(mature)}</span><span class="m-cap"
        >maduras <Info text={NOTES.mature} /></span
      >
    </div>
    <div>
      <span class="m-num">{show(refold ? rate(refold.young) : null)}</span>
      <span class="m-cap">retención Refold <Info text={NOTES.retention(FEW_ANSWERS)} /></span>
    </div>
    <div class:dim={mined.young.reviews < FEW_ANSWERS}>
      <span class="m-num">{show(rate(mined.young))}</span>
      <span class="m-cap">retención minadas</span>
    </div>
  </section>

  <section class="card">
    <h2>Por origen</h2>
    <ul class="m-origins">
      {#each origins as origin (origin.origin)}
        <li>
          <span class="m-name"
            ><i style:background={color[origin.origin]}></i>{ORIGIN_LABELS[origin.origin] ??
              origin.origin}</span
          >
          <span class="m-bar"
            ><span
              style:width={`${(origin.cards / Math.max(total, 1)) * 100}%`}
              style:background={color[origin.origin]}
            ></span></span
          >
          <span class="m-count">{number.format(origin.cards)}</span>
          <span class="m-rate" class:dim={origin.young.reviews < FEW_ANSWERS}>{show(rate(origin.young))}</span
          >
        </li>
      {/each}
    </ul>
  </section>

  <section class="card">
    <h2>Llegaron a maduras <Info text={NOTES.matured} /></h2>
    <Chart option={chart} height={220} label="Tarjetas que llegaron a maduras por semana, Refold y minadas" />
  </section>
{/if}

<style>
  .m-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 40px;
    font-size: 2.25rem;
    font-weight: 300;
    letter-spacing: -0.03em;
  }

  .m-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 32px;
    margin-bottom: 64px;
  }

  .m-row div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .m-num {
    font-size: 2.75rem;
    font-weight: 300;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .m-cap {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }

  .dim .m-num,
  .m-rate.dim {
    color: var(--muted);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .m-origins {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .m-origins li {
    display: grid;
    grid-template-columns: minmax(130px, 1fr) 2fr 70px 56px;
    align-items: center;
    gap: 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
  }

  .m-name i {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 10px;
    border-radius: 50%;
  }

  .m-bar {
    height: 4px;
    border-radius: 2px;
    background: var(--grid);
    overflow: hidden;
  }

  .m-bar span {
    display: block;
    height: 100%;
    min-width: 2px;
  }

  .m-count,
  .m-rate {
    text-align: right;
  }
</style>
