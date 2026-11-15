<script lang="ts">
  import { getAnki } from "../../lib/api";
  import Chart, { type Theme } from "../../lib/Chart.svelte";
  import { minedTotals, rate } from "../../lib/data";
  import { ORIGIN_LABELS, dayShort, number, percent } from "../../lib/format";
  import Info from "../../lib/Info.svelte";
  import { load } from "../../lib/load.svelte";
  import { FEW_ANSWERS, NOTES } from "../../lib/notes";
  import { baseOption, categoryAxis, valueAxis } from "../../lib/vizkit";

  const anki = load(getAnki);
  const origins = $derived(anki.data?.origins ?? []);
  const total = $derived(origins.reduce((sum, origin) => sum + origin.cards, 0));
  const mature = $derived(origins.reduce((sum, origin) => sum + origin.mature, 0));
  const mined = $derived(minedTotals(origins));
  const gem = (origin: string) => `var(--series-${origin === "refold-1k" ? "refold" : origin})`;
  const gemName: Record<string, string> = {
    gsm: "Saphir",
    youtube: "Feuer",
    "refold-1k": "Smaragd",
    unknown: "Stein",
  };

  const chart = $derived.by(() => {
    const weeks = anki.data?.weeks ?? [];
    return (theme: Theme) => {
      const base = baseOption(theme, { legend: true });
      const line = (name: string, color: string, values: number[]) => ({
        type: "line",
        name,
        data: values,
        step: "end",
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
</script>

{#if anki.error}
  <p class="error">No se pudo leer Anki: {anki.error}</p>
{:else if !anki.data}
  <p class="muted">Cargando…</p>
{:else}
  <section class="s-panel s-summary">
    <div>
      <p class="s-heading">Sammlung <small>tarjetas</small> <Info text={NOTES.origins} /></p>
      <p class="s-big s-num">{number.format(total)}</p>
    </div>
    <div>
      <p class="s-heading">Gemeistert <small>maduras</small> <Info text={NOTES.mature} /></p>
      <p class="s-big s-num">{number.format(mature)}</p>
    </div>
    <div>
      <p class="s-heading">Selbst gefunden <small>minadas</small></p>
      <p class="s-big s-num">{number.format(mined.cards)}</p>
    </div>
  </section>

  <section class="s-panel">
    <p class="s-heading">
      Treffsicherheit <small>retención por origen</small>
      <Info text={NOTES.retention(FEW_ANSWERS)} />
    </p>
    <ul class="s-gems">
      {#each origins as origin (origin.origin)}
        {@const young = rate(origin.young)}
        <li class:dim={origin.young.reviews < FEW_ANSWERS}>
          <span class="s-gem" style:--gem={gem(origin.origin)} aria-hidden="true"></span>
          <span class="s-who"
            >{gemName[origin.origin] ?? origin.origin}<small
              >{ORIGIN_LABELS[origin.origin]} · {number.format(origin.cards)}</small
            ></span
          >
          <span class="s-meter" aria-hidden="true"
            ><span style:width={`${(young ?? 0) * 100}%`} style:background={gem(origin.origin)}></span></span
          >
          <span class="s-pct s-num">{young === null ? "—" : percent.format(young)}</span>
          <span class="s-answers s-num">{number.format(origin.young.reviews)} resp.</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="s-panel">
    <p class="s-heading">
      Wortschatz <small>tarjetas que llegaron a maduras</small>
      <Info text={NOTES.matured} />
    </p>
    <Chart option={chart} height={260} label="Tarjetas que llegaron a maduras, acumulado por semana" />
  </section>
{/if}

<style>
  .s-panel {
    margin-bottom: 14px;
  }

  .s-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 20px;
  }

  .s-big {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 700;
  }

  .s-gems {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }

  .s-gems li {
    display: grid;
    grid-template-columns: 34px minmax(140px, 1fr) 2fr 56px 96px;
    align-items: center;
    gap: 12px;
  }

  .s-gems li.dim .s-pct {
    color: var(--muted);
  }

  .s-gem {
    width: 22px;
    height: 22px;
    margin: 0 auto;
    transform: rotate(45deg);
    border-radius: 3px;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--gem) 55%, #fff),
      var(--gem) 55%,
      color-mix(in srgb, var(--gem) 60%, #000)
    );
    box-shadow: 0 0 12px color-mix(in srgb, var(--gem) 45%, transparent);
  }

  .s-who {
    display: flex;
    flex-direction: column;
    color: var(--accent);
    font-weight: 600;
  }

  .s-who small {
    color: var(--muted);
    font-weight: 400;
  }

  .s-meter {
    height: 12px;
    padding: 2px;
    border: 1px solid var(--frame);
    border-radius: 3px;
    background: var(--bg);
  }

  .s-meter span {
    display: block;
    height: 100%;
    border-radius: 2px;
  }

  .s-pct {
    text-align: right;
    font-weight: 700;
  }

  .s-answers {
    text-align: right;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  @media (max-width: 1000px) {
    .s-gems li {
      grid-template-columns: 30px 1fr 56px;
    }

    .s-meter,
    .s-answers {
      display: none;
    }
  }
</style>
