<script lang="ts">
  import type { ContentSummary, HighlightContent } from "@mosaik/shared";
  import { getContents, getStats } from "../lib/api";
  import Chart, { type Theme } from "../lib/Chart.svelte";
  import Cover from "../lib/Cover.svelte";
  import { dayLong, dayShort, duration, number } from "../lib/format";
  import Info from "../lib/Info.svelte";
  import { load } from "../lib/load.svelte";
  import { NOTES } from "../lib/notes";
  import { type PeriodKind, periodRows, weekdayRhythm } from "../lib/periods";
  import { hrefContent, hrefDay } from "../lib/router.svelte";
  import Toggle from "../lib/Toggle.svelte";
  import { barSeries, baseOption, categoryAxis, valueAxis } from "../lib/vizkit";

  const stats = load(getStats);
  const contents = load(getContents);

  const byId = $derived(new Map((contents.data?.contents ?? []).map((content) => [content.id, content])));
  const days = $derived(stats.data?.days ?? []);
  const highlights = $derived(stats.data?.highlights);

  // A content of a highlight, with its cover when the library has it
  const summaryOf = (item: HighlightContent): ContentSummary =>
    byId.get(item.id) ?? {
      id: item.id,
      source: "",
      kind: item.kind,
      title: item.title,
      seconds: 0,
      sessions: 0,
      words: null,
      characters: null,
      cardsMined: 0,
      firstDay: null,
      lastDay: null,
      cover: null,
      coverSource: null,
    };

  const contentHighlights = $derived(
    highlights
      ? [
          { label: "Más tiempo", item: highlights.mostTime, value: (v: number) => duration(v) },
          {
            label: "Más sesiones",
            item: highlights.mostSessions,
            value: (v: number) => `${number.format(v)} sesiones`,
          },
          {
            label: "Más palabras",
            item: highlights.mostWords,
            value: (v: number) => `${number.format(v)} palabras`,
          },
          {
            label: "Más tarjetas minadas",
            item: highlights.mostMined,
            value: (v: number) => `${number.format(v)} ${v === 1 ? "tarjeta" : "tarjetas"}`,
          },
        ].filter((entry): entry is typeof entry & { item: HighlightContent } => entry.item !== null)
      : [],
  );

  const range = (from: string, to: string) =>
    from === to ? dayShort(from) : `${dayShort(from)} – ${dayShort(to)}`;

  // The rhythm of the week, over the last 12 weeks or the whole history
  let rhythmRange = $state<"recent" | "all">("recent");
  const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const rhythm = $derived(weekdayRhythm(rhythmRange === "recent" ? days.slice(-12 * 7) : days));
  const rhythmChart = $derived((theme: Theme) => {
    const base = baseOption(theme, { legend: true });
    const toMinutes = (seconds: number) => +(seconds / 60).toFixed(1);
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        formatter: (items: { dataIndex: number }[]) => {
          const day = rhythm[items[0]?.dataIndex ?? 0]!;
          return [
            `<b>${WEEKDAYS[day.weekday]}</b> (${day.count} días)`,
            `Promedio ${duration(day.average)}`,
            `· juegos ${duration(day.averageGsm)} · Deuchan ${duration(day.averageDeuchan)}`,
            `Mediana ${duration(day.median)}`,
          ].join("<br>");
        },
      },
      xAxis: categoryAxis(theme, WEEKDAYS),
      yAxis: valueAxis(theme, "minutos por día"),
      series: [
        barSeries(
          theme,
          "Juegos (GSM)",
          theme.gsm,
          rhythm.map((day) => toMinutes(day.averageGsm)),
          "avg",
        ),
        barSeries(
          theme,
          "Deuchan",
          theme.youtube,
          rhythm.map((day) => toMinutes(day.averageDeuchan)),
          "avg",
        ),
        {
          type: "scatter",
          name: "Mediana",
          // A median of zero stays in the tooltip; drawn, it would only be a line on the axis
          data: rhythm.map((day) => (day.median > 0 ? toMinutes(day.median) : null)),
          symbol: "rect",
          symbolSize: [22, 3],
          itemStyle: { color: theme.text },
          z: 5,
        },
      ],
    };
  });

  let periodKind = $state<PeriodKind>("week");
  const rows = $derived(periodRows(days, periodKind));
  const monthName = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
  const periodLabel = (key: string) =>
    periodKind === "week"
      ? `Semana del ${dayShort(key)}`
      : periodKind === "month"
        ? monthName.format(new Date(`${key}-15T12:00:00Z`))
        : key;
  const change = (value: number | null) =>
    value === null || Math.round(value / 60) === 0
      ? { text: "=", dir: "same" }
      : value > 0
        ? { text: `▲ ${duration(value)}`, dir: "up" }
        : { text: `▼ ${duration(-value)}`, dir: "down" };
</script>

<header class="k-head">
  <h1>Estadísticas</h1>
  {#if days.length > 0}
    <Info
      text={`Todo tu historial: desde el ${dayLong(days[0]!.day)}, el primer día con algo en Mosaik. ${NOTES.immersion}`}
      label="Qué abarcan"
    />
  {/if}
</header>

{#if stats.error}
  <p class="error">No se pudieron leer las estadísticas: {stats.error}</p>
{:else if !stats.data || !highlights}
  <p class="muted">Cargando…</p>
{:else}
  <section aria-labelledby="highlights-title">
    <h2 id="highlights-title" class="k-section">Destacados</h2>
    <ul class="k-highlights">
      {#each contentHighlights as entry (entry.label)}
        <li>
          <a class="k-hl" href={hrefContent(entry.item.id)}>
            <span class="k-hl-cover" class:video={entry.item.kind === "video"}
              ><Cover content={summaryOf(entry.item)} /></span
            >
            <span class="k-hl-text">
              <span class="k-label">{entry.label}</span>
              <span class="k-hl-title">{entry.item.title ?? entry.item.id}</span>
              <span class="k-hl-value">{entry.value(entry.item.value)}</span>
            </span>
          </a>
        </li>
      {/each}
      {#if highlights.biggestDay}
        <li>
          <a class="k-hl plain" href={hrefDay(highlights.biggestDay.day)}>
            <span class="k-hl-text">
              <span class="k-label">Mejor día</span>
              <span class="k-hl-big">{duration(highlights.biggestDay.seconds)}</span>
              <span class="k-hl-value">{dayLong(highlights.biggestDay.day)}</span>
            </span>
          </a>
        </li>
      {/if}
      {#if highlights.longestStreak}
        <li>
          <div class="k-hl plain">
            <span class="k-hl-text">
              <span class="k-label">Racha más larga <Info text={NOTES.streak} /></span>
              <span class="k-hl-big">
                {highlights.longestStreak.days}
                <small>{highlights.longestStreak.days === 1 ? "día" : "días"}</small>
              </span>
              <span class="k-hl-value"
                >{range(highlights.longestStreak.from, highlights.longestStreak.to)}</span
              >
            </span>
          </div>
        </li>
      {/if}
      {#if highlights.longestTitleStreak}
        {@const streak = highlights.longestTitleStreak}
        <li>
          <a class="k-hl" href={hrefContent(streak.id)}>
            <span class="k-hl-cover" class:video={streak.kind === "video"}>
              <Cover
                content={summaryOf({ id: streak.id, title: streak.title, kind: streak.kind, value: 0 })}
              />
            </span>
            <span class="k-hl-text">
              <span class="k-label">Racha con un título</span>
              <span class="k-hl-title">{streak.title ?? streak.id}</span>
              <span class="k-hl-value"
                >{streak.days}
                {streak.days === 1 ? "día" : "días seguidos"} · {range(streak.from, streak.to)}</span
              >
            </span>
          </a>
        </li>
      {/if}
    </ul>
    {#if contentHighlights.length === 0 && !highlights.biggestDay}
      <p class="muted">Todavía no hay datos.</p>
    {/if}
  </section>

  <section class="card">
    <div class="k-chart-head">
      <h2>
        Ritmo de la semana
        <Info
          text="Promedio de inmersión por día de la semana, contando también los días sin nada; la marca clara es la mediana (si es cero, no se dibuja; está en el detalle al pasar el mouse). Los días de Mosaik empiezan a la hora de corte, no a medianoche."
        />
      </h2>
      <Toggle
        label="Período del ritmo"
        options={[
          ["recent", "Últimas 12 semanas"],
          ["all", "Todo"],
        ] as const}
        bind:value={rhythmRange}
      />
    </div>
    <Chart option={rhythmChart} height={240} label="Inmersión promedio por día de la semana" />
  </section>

  <section class="card">
    <div class="k-chart-head">
      <h2>Por período</h2>
      <Toggle
        label="Período"
        options={[
          ["week", "Semana"],
          ["month", "Mes"],
          ["year", "Año"],
        ] as const}
        bind:value={periodKind}
      />
    </div>
    <div class="k-table-wrap">
      <table class="k-periods">
        <thead>
          <tr>
            <th scope="col">Período</th>
            <th scope="col" class="num">Inmersión</th>
            <th scope="col" class="num">Cambio</th>
            <th scope="col" class="num">Juegos</th>
            <th scope="col" class="num">Deuchan</th>
            <th scope="col" class="num">Días activos</th>
            <th scope="col" class="num">Repasos</th>
            <th scope="col" class="num">Minadas</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.key)}
            {@const delta = change(row.change)}
            <tr>
              <th scope="row">
                {periodLabel(row.key)}
                {#if row.current}<span class="k-current">en curso</span>{/if}
              </th>
              <td class="num strong">{duration(row.immersion)}</td>
              <td class="num delta {delta.dir}">{delta.text}</td>
              <td class="num">{duration(row.gsmSeconds)}</td>
              <td class="num">{duration(row.deuchanSeconds)}</td>
              <td class="num">{row.activeDays}</td>
              <td class="num">{number.format(row.reviews)}</td>
              <td class="num">{number.format(row.cardsMined)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
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

  h2,
  .k-section {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9286rem !important;
    color: var(--muted);
  }

  .k-section {
    margin: 0 0 10px;
    font-weight: 500;
  }

  .k-highlights {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }

  .k-hl {
    display: flex;
    gap: 12px;
    height: 100%;
    box-sizing: border-box;
    padding: 12px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }

  a.k-hl:hover,
  a.k-hl:focus-visible {
    border-color: var(--accent);
  }

  .k-hl.plain {
    padding: 14px 16px;
  }

  .k-hl-cover {
    flex: none;
    width: 54px;
    aspect-ratio: 3 / 4;
    border-radius: 8px;
    overflow: hidden;
  }

  .k-hl-cover.video {
    width: 86px;
    aspect-ratio: 16 / 9;
    align-self: center;
  }

  .k-hl-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .k-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 0.75rem;
  }

  .k-hl-title {
    font-weight: 500;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .k-hl-big {
    font-size: 1.5rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }

  .k-hl-big small {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--muted);
  }

  .k-hl-value {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .k-chart-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .k-table-wrap {
    overflow-x: auto;
  }

  .k-periods {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .k-periods th,
  .k-periods td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }

  .k-periods thead th {
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .k-periods tbody th {
    font-weight: 500;
  }

  .k-periods tbody tr:last-child > * {
    border-bottom: 0;
  }

  .num {
    text-align: right !important;
    font-variant-numeric: tabular-nums;
  }

  .strong {
    font-weight: 500;
  }

  .delta.up {
    color: var(--positive);
  }

  .delta.down,
  .delta.same {
    color: var(--muted);
  }

  .k-current {
    margin-left: 6px;
    padding: 0;
    border-radius: 0;
    font-size: 0.6875rem;
    color: var(--muted);
    font-family: var(--mono);
  }
</style>
