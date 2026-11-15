<script lang="ts">
  import type { ContentDetailResponse } from "@mosaik/shared";
  import { getContent } from "../lib/api";
  import Chart, { type Theme } from "../lib/Chart.svelte";
  import CoverPicker from "../lib/CoverPicker.svelte";
  import { barSeries, baseOption, categoryAxis, valueAxis } from "../lib/charts";
  import {
    KIND_LABELS,
    cleanLine,
    dayShort,
    duration,
    minutes,
    number,
    percent,
    timeOf,
  } from "../lib/format";
  import { hrefDay, hrefSearch } from "../lib/router.svelte";

  let { id }: { id: string } = $props();

  let data = $state<ContentDetailResponse | null>(null);
  let error = $state<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function fetchContent(wanted: string) {
    getContent(wanted)
      .then((result) => {
        if (wanted === id) data = result;
      })
      .catch((cause: unknown) => (error = cause instanceof Error ? cause.message : String(cause)));
  }

  $effect(() => {
    const wanted = id;
    data = null;
    error = null;
    fetchContent(wanted);
  });

  const isVideo = $derived(data?.content.kind === "video");
  const color = (theme: Theme) => (isVideo ? theme.youtube : theme.gsm);

  const daysChart = $derived.by(() => {
    const days = data?.days ?? [];
    return (theme: Theme) => ({
      ...baseOption(theme, { legend: false }),
      tooltip: {
        ...baseOption(theme, { legend: false }).tooltip,
        formatter: (items: { dataIndex: number }[]) => {
          const day = days[items[0]?.dataIndex ?? 0];
          return day
            ? `<b>${dayShort(day.day)}</b><br>${duration(day.seconds)}<br><span style="opacity:.7">Clic para ver el día</span>`
            : "";
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
          "Tiempo",
          color(theme),
          days.map((day) => minutes(day.seconds)),
          true,
        ),
      ],
    });
  });

  const openDay = (index: number) => {
    const day = data?.days[index];
    if (day) location.hash = hrefDay(day.day);
  };
</script>

<p><a href="#/contenido">← Contenido</a></p>

{#if error}
  <p class="error">No se pudo leer este contenido: {error}</p>
{:else if !data}
  <p class="muted">Cargando…</p>
{:else}
  {@const content = data.content}
  <header class="head">
    <CoverPicker {content} onchange={() => fetchContent(id)} />
    <div>
      <h2 class="title">{content.title ?? content.id}</h2>
      <p class="muted">
        {KIND_LABELS[content.kind] ?? content.kind} · {isVideo
          ? "YouTube, según Deuchan"
          : "GameSentenceMiner"}
        {#if content.url}· <a href={content.url} target="_blank" rel="noreferrer">abrir en YouTube</a>{/if}
      </p>
    </div>
  </header>

  <section class="tiles" aria-label="Totales">
    <div class="tile">
      <span class="value">{duration(content.seconds)}</span><span class="label">tiempo</span>
    </div>
    {#if content.sessions > 0}
      <div class="tile">
        <span class="value">{number.format(content.sessions)}</span><span class="label">sesiones</span>
      </div>
    {/if}
    {#if content.characters !== null}
      <div class="tile">
        <span class="value">{number.format(content.characters)}</span><span class="label"
          >caracteres leídos</span
        >
      </div>
    {/if}
    {#if data.charactersPerHour !== null}
      <div class="tile">
        <span class="value">{number.format(data.charactersPerHour)}</span><span class="label"
          >caracteres por hora</span
        >
      </div>
    {/if}
    {#if data.completion !== null}
      <div class="tile">
        <span class="value">{percent.format(data.completion)}</span><span class="label">leído</span>
      </div>
    {/if}
    <div class="tile">
      <span class="value">{number.format(content.cardsMined)}</span><span class="label">tarjetas minadas</span
      >
    </div>
  </section>
  <p class="note">
    {#if isVideo}
      Tiempo: lo que Deuchan le acreditó a este video cada día, en esta computadora. Para un video no se
      muestra velocidad ni porcentaje: no aplican.
    {:else}
      Tiempo de lectura calculado como GSM, en alemán. Los caracteres se cuentan como GSM: sin espacios ni
      puntuación, así que la velocidad solo se compara con vos mismo.
      {#if data.completion === null}No hay porcentaje leído porque GSM no conoce el largo de este juego.{/if}
    {/if}
  </p>

  {#if data.days.length > 0}
    <section class="card">
      <h2>Tiempo por día</h2>
      <Chart option={daysChart} onselect={openDay} height={200} label="Minutos por día en este contenido" />
    </section>
  {/if}

  <section class="card" aria-labelledby="cards-title">
    <h2 id="cards-title">Tarjetas minadas</h2>
    {#if data.cards.length === 0}
      <p class="muted">Ninguna todavía.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th scope="col">Palabra</th>
            <th scope="col">Cuándo</th>
            <th scope="col">Oración</th>
          </tr>
        </thead>
        <tbody>
          {#each data.cards as card (card.noteId)}
            <tr>
              <td>{card.word ?? "—"}</td>
              <td
                >{dayShort(new Intl.DateTimeFormat("en-CA", { timeZone }).format(card.created))}
                {timeOf(card.created, timeZone)}</td
              >
              <td>{card.line ? cleanLine(card.line) : "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  {#if data.sessions.length > 0}
    <section class="card" aria-labelledby="sessions-title">
      <h2 id="sessions-title">Sesiones</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Inicio</th>
            <th scope="col">Fin</th>
            <th scope="col" class="num">Tiempo</th>
            {#if !isVideo}<th scope="col" class="num">Líneas</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each data.sessions as session (session.id)}
            <tr class:other={session.language !== "de"}>
              <td
                >{dayShort(new Intl.DateTimeFormat("en-CA", { timeZone }).format(session.start))}
                {timeOf(session.start, timeZone)}</td
              >
              <td>{timeOf(session.end, timeZone)}</td>
              <td class="num">{duration(session.seconds)}</td>
              {#if !isVideo}<td class="num">{number.format(session.lines ?? 0)}</td>{/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if data.lines.length > 0}
    <section class="card" aria-labelledby="lines-title">
      <h2 id="lines-title">Últimas oraciones</h2>
      <p class="note">Las {data.lines.length} más recientes. <a href={hrefSearch("")}>Buscar en todas</a>.</p>
      <ol class="lines">
        {#each data.lines as line (line.id)}
          <li>
            <span class="time">{timeOf(line.ts, timeZone)}</span>
            <span>{cleanLine(line.text)}</span>
            {#each line.mined as word (word)}<span class="badge" title="Tarjeta minada de esta oración"
                >{word}</span
              >{/each}
          </li>
        {/each}
      </ol>
    </section>
  {/if}
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 20px;
  }

  .head > div {
    flex: 1;
    min-width: 240px;
  }

  .title {
    font-size: 1.25rem;
    margin: 0;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin: 16px 0 8px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
  }

  .value {
    font-size: 1.25rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .label {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  tr.other {
    color: var(--muted);
  }

  .lines {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .lines li {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }

  .time {
    color: var(--muted);
    font-size: 0.8125rem;
    margin-right: 8px;
    font-variant-numeric: tabular-nums;
  }

  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 0 8px;
    border-radius: 4px;
    border: 1px solid var(--border-strong);
    font-size: 0.75rem;
  }
</style>
