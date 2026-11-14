<script lang="ts">
  import type { DaySummary, OverviewResponse } from "@mosaik/shared";
  import { onMount } from "svelte";
  import { getOverview } from "../lib/api";
  import Chart, { type Theme } from "../lib/Chart.svelte";
  import { barSeries, baseOption, categoryAxis, valueAxis } from "../lib/charts";
  import { dayShort, duration, minutes, number } from "../lib/format";
  import { hrefDay } from "../lib/router.svelte";

  let data = $state<OverviewResponse | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    try {
      data = await getOverview(30);
      error = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  });

  const immersion = (day: DaySummary) => day.gsmSeconds + (day.deuchanSeconds ?? 0);
  const today = $derived(data?.days.at(-1) ?? null);
  const week = $derived(data ? data.days.slice(-7) : []);
  const weekSeconds = $derived(week.reduce((sum, day) => sum + immersion(day), 0));
  const weekReviews = $derived(week.reduce((sum, day) => sum + day.reviews, 0));

  const open = (index: number) => {
    const day = data?.days[index];
    if (day) location.hash = hrefDay(day.day);
  };

  const immersionChart = $derived.by(() => {
    const days = data?.days ?? [];
    return (theme: Theme) => ({
      ...baseOption(theme, { legend: true }),
      tooltip: {
        ...baseOption(theme, { legend: true }).tooltip,
        formatter: (items: { dataIndex: number }[]) => {
          const day = days[items[0]?.dataIndex ?? 0];
          if (!day) return "";
          return [
            `<b>${dayShort(day.day)}</b>`,
            `Juegos (GSM): ${duration(day.gsmSeconds)}`,
            `YouTube (Deuchan): ${day.deuchanSeconds === null ? "sin datos" : duration(day.deuchanSeconds)}`,
            `Total: ${duration(immersion(day))}`,
            `<span style="opacity:.7">Clic para ver el día</span>`,
          ].join("<br>");
        },
      },
      xAxis: categoryAxis(
        theme,
        days.map((day) => dayShort(day.day)),
      ),
      yAxis: valueAxis(theme, "minutos"),
      series: [
        barSeries(
          theme,
          "Juegos (GSM)",
          theme.gsm,
          days.map((day) => minutes(day.gsmSeconds)),
          false,
          "immersion",
        ),
        barSeries(
          theme,
          "YouTube (Deuchan)",
          theme.youtube,
          days.map((day) => minutes(day.deuchanSeconds ?? 0)),
          true,
          "immersion",
        ),
      ],
    });
  });

  const reviewsChart = $derived.by(() => {
    const days = data?.days ?? [];
    return (theme: Theme) => ({
      ...baseOption(theme, { legend: false }),
      tooltip: {
        ...baseOption(theme, { legend: false }).tooltip,
        formatter: (items: { dataIndex: number }[]) => {
          const day = days[items[0]?.dataIndex ?? 0];
          return day
            ? `<b>${dayShort(day.day)}</b><br>${number.format(day.reviews)} repasos · ${duration(day.reviewSeconds)}`
            : "";
        },
      },
      xAxis: categoryAxis(
        theme,
        days.map((day) => dayShort(day.day)),
      ),
      yAxis: valueAxis(theme, "repasos"),
      series: [
        barSeries(
          theme,
          "Repasos",
          theme.anki,
          days.map((day) => day.reviews),
          true,
        ),
      ],
    });
  });
</script>

{#if error}
  <p class="error">No se pudo leer el resumen: {error}</p>
{:else if !data || !today}
  <p class="muted">Cargando…</p>
{:else}
  <section class="tiles" aria-label="Resumen">
    <a class="tile" href={hrefDay(today.day)}>
      <span class="value">{duration(immersion(today))}</span>
      <span class="label">inmersión hoy</span>
    </a>
    <div class="tile">
      <span class="value">{duration(weekSeconds)}</span>
      <span class="label">últimos 7 días</span>
    </div>
    <div class="tile">
      <span class="value">{data.streak} {data.streak === 1 ? "día" : "días"}</span>
      <span class="label">racha</span>
    </div>
    <div class="tile">
      <span class="value">{number.format(today.reviews)}</span>
      <span class="label">repasos hoy · {number.format(weekReviews)} en 7 días</span>
    </div>
    <div class="tile">
      <span class="value">{number.format(today.cardsMined)}</span>
      <span class="label">tarjetas minadas hoy</span>
    </div>
  </section>

  <section class="card">
    <h2>Inmersión por día</h2>
    <p class="note">
      Últimos 30 días. Tocá una barra para ver de dónde sale cada número. Los días de Mosaik van de las
      {data.cutoffHour}:00 a las {data.cutoffHour}:00 (como Anki); el tiempo de YouTube es el que muestra
      Deuchan, que cuenta de medianoche a medianoche.
    </p>
    <Chart option={immersionChart} onselect={open} label="Minutos de inmersión por día, por fuente" />
  </section>

  <section class="card">
    <h2>Repasos de Anki por día</h2>
    <p class="note">Aprendizaje, repaso, reaprendizaje y filtrado, como los cuenta Anki.</p>
    <Chart option={reviewsChart} onselect={open} height={200} label="Repasos de Anki por día" />
  </section>

  <section class="card">
    <h2>Los mismos datos, en tabla</h2>
    <table>
      <thead>
        <tr>
          <th scope="col">Día</th>
          <th scope="col" class="num">Juegos</th>
          <th scope="col" class="num">YouTube</th>
          <th scope="col" class="num">Repasos</th>
          <th scope="col" class="num">Minadas</th>
        </tr>
      </thead>
      <tbody>
        {#each [...data.days].reverse() as day (day.day)}
          {#if immersion(day) > 0 || day.reviews > 0 || day.cardsMined > 0}
            <tr>
              <td><a href={hrefDay(day.day)}>{dayShort(day.day)}</a></td>
              <td class="num">{day.gsmSeconds > 0 ? duration(day.gsmSeconds) : "—"}</td>
              <td class="num">{day.deuchanSeconds === null ? "—" : duration(day.deuchanSeconds)}</td>
              <td class="num">{day.reviews > 0 ? number.format(day.reviews) : "—"}</td>
              <td class="num">{day.cardsMined > 0 ? number.format(day.cardsMined) : "—"}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    color: inherit;
    text-decoration: none;
  }

  a.tile:hover {
    border-color: var(--muted);
  }

  .value {
    font-size: 1.5rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .label {
    color: var(--muted);
    font-size: 0.8125rem;
  }
</style>
