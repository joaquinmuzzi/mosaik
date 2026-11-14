<script lang="ts">
  import type { AnkiStatsResponse, OriginRetention } from "@mosaik/shared";
  import { onMount } from "svelte";
  import { getAnki } from "../lib/api";
  import Chart, { type Theme } from "../lib/Chart.svelte";
  import { barSeries, baseOption, categoryAxis, valueAxis } from "../lib/charts";
  import { ORIGIN_LABELS, dayShort, duration, number, percent } from "../lib/format";

  /** Below this many answers a rate says nothing; it is shown, but marked. */
  const FEW = 30;

  let data = $state<AnkiStatsResponse | null>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    getAnki()
      .then((result) => (data = result))
      .catch((cause: unknown) => (error = cause instanceof Error ? cause.message : String(cause)));
  });

  const swatch: Record<string, string> = {
    gsm: "var(--series-gsm)",
    youtube: "var(--series-youtube)",
    "refold-1k": "var(--series-refold)",
    unknown: "var(--series-unknown)",
  };

  const totalCards = $derived(data?.origins.reduce((sum, origin) => sum + origin.cards, 0) ?? 0);

  const weeksChart = $derived.by(() => {
    const weeks = data?.weeks ?? [];
    return (theme: Theme) => ({
      ...baseOption(theme, { legend: true }),
      tooltip: {
        ...baseOption(theme, { legend: true }).tooltip,
        formatter: (items: { dataIndex: number }[]) => {
          const week = weeks[items[0]?.dataIndex ?? 0];
          return week
            ? `<b>Semana del ${dayShort(week.week)}</b><br>Juegos (GSM): ${duration(week.gsmSeconds)}<br>YouTube (Deuchan): ${duration(week.deuchanSeconds)}`
            : "";
        },
      },
      xAxis: categoryAxis(
        theme,
        weeks.map((week) => dayShort(week.week)),
      ),
      yAxis: valueAxis(theme, "horas"),
      series: [
        barSeries(
          theme,
          "Juegos (GSM)",
          theme.gsm,
          weeks.map((week) => +(week.gsmSeconds / 3600).toFixed(2)),
          false,
          "h",
        ),
        barSeries(
          theme,
          "YouTube (Deuchan)",
          theme.youtube,
          weeks.map((week) => +(week.deuchanSeconds / 3600).toFixed(2)),
          true,
          "h",
        ),
      ],
    });
  });

  const maturedChart = $derived.by(() => {
    const weeks = data?.weeks ?? [];
    const line = (theme: Theme, name: string, color: string, values: number[]) => ({
      type: "line",
      name,
      data: values,
      symbol: "circle",
      symbolSize: 8,
      lineStyle: { width: 2, color },
      itemStyle: { color, borderColor: theme.surface, borderWidth: 2 },
      // A direct label at the end of each line, so identity never rests on color alone
      endLabel: { show: true, formatter: "{a}", color: theme.text },
    });
    return (theme: Theme) => ({
      ...baseOption(theme, { legend: true }),
      grid: { ...baseOption(theme, { legend: true }).grid, right: 110 },
      tooltip: {
        ...baseOption(theme, { legend: true }).tooltip,
        axisPointer: { type: "line", lineStyle: { color: theme.muted } },
      },
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
          theme,
          "Refold 1k",
          theme.refold,
          weeks.map((week) => week.maturedRefold),
        ),
        line(
          theme,
          "Minadas",
          theme.gsm,
          weeks.map((week) => week.maturedMined),
        ),
      ],
    });
  });

  function rate(retention: OriginRetention): string {
    if (retention.reviews === 0) return "sin datos";
    return `${percent.format(retention.passed / retention.reviews)} (${number.format(retention.reviews)})`;
  }
</script>

{#if error}
  <p class="error">No se pudo leer Anki: {error}</p>
{:else if !data}
  <p class="muted">Cargando…</p>
{:else}
  <section class="card" aria-labelledby="origins-title">
    <h2 id="origins-title">Tarjetas por origen</h2>
    <p class="note">
      De dónde salió cada tarjeta: la línea de GSM de la que se minó, el video de YouTube que estabas mirando
      (por el título que guarda Yomitan), el mazo de Refold, o "sin origen" cuando ninguna regla la reconoce.
    </p>
    <table>
      <thead>
        <tr>
          <th scope="col">Origen</th>
          <th scope="col" class="num">Tarjetas</th>
          <th scope="col" class="num">Maduras</th>
          <th scope="col" class="num">Retención jóvenes</th>
          <th scope="col" class="num">Retención maduras</th>
        </tr>
      </thead>
      <tbody>
        {#each data.origins as origin (origin.origin)}
          <tr>
            <td>
              <span class="swatch" style:background={swatch[origin.origin]} aria-hidden="true"></span>
              {ORIGIN_LABELS[origin.origin] ?? origin.origin}
            </td>
            <td class="num">
              {number.format(origin.cards)}
              <span
                class="bar"
                style:width={`${(origin.cards / Math.max(totalCards, 1)) * 100}%`}
                style:background={swatch[origin.origin]}
              ></span>
            </td>
            <td class="num">{number.format(origin.mature)}</td>
            <td class="num" class:few={origin.young.reviews > 0 && origin.young.reviews < FEW}
              >{rate(origin.young)}</td
            >
            <td
              class="num"
              class:few={origin.matureRetention.reviews > 0 && origin.matureRetention.reviews < FEW}
              >{rate(origin.matureRetention)}</td
            >
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="note">
      Retención: de las respuestas a tarjetas en repaso, cuántas no fueron "Otra vez"; entre paréntesis,
      cuántas respuestas hay. Jóvenes: intervalo previo menor a 21 días; maduras: 21 o más. Con menos de {FEW} respuestas
      el porcentaje aparece atenuado: todavía no dice mucho.
    </p>
  </section>

  <section class="card">
    <h2>Inmersión por semana</h2>
    <Chart option={weeksChart} label="Horas de inmersión por semana, por fuente" />
  </section>

  <section class="card">
    <h2>Tarjetas que llegaron a maduras</h2>
    <p class="note">
      Acumulado por semana: cada tarjeta cuenta la primera vez que su intervalo llegó a 21 días. Para comparar
      con la inmersión de arriba, semana a semana (son dos gráficos a propósito: miden cosas distintas).
    </p>
    <Chart option={maturedChart} label="Tarjetas maduras acumuladas por semana, Refold y minadas" />
  </section>
{/if}

<style>
  .swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    margin-right: 6px;
    vertical-align: -1px;
  }

  .bar {
    display: block;
    height: 4px;
    border-radius: 2px;
    margin: 4px 0 0 auto;
  }

  .few {
    color: var(--muted);
  }
</style>
