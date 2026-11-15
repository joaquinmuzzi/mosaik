<script lang="ts">
  import type { DayDetailResponse } from "@mosaik/shared";
  import { getDay } from "../lib/api";
  import { ORIGIN_LABELS, addDays, dayLong, duration, number, timeOf } from "../lib/format";
  import { hrefDay } from "../lib/router.svelte";

  let { day }: { day: string } = $props();

  let data = $state<DayDetailResponse | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const wanted = day;
    data = null;
    getDay(wanted)
      .then((result) => {
        if (wanted === day) {
          data = result;
          error = null;
        }
      })
      .catch((cause: unknown) => (error = cause instanceof Error ? cause.message : String(cause)));
  });

  const total = $derived(data ? data.gsm.seconds + (data.deuchan.seconds ?? 0) : 0);
  const pick = (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (value) location.hash = hrefDay(value);
  };
</script>

<nav class="day-nav" aria-label="Cambiar de día">
  <a href={hrefDay(addDays(day, -1))} aria-label="Día anterior">← anterior</a>
  <input type="date" value={day} onchange={pick} aria-label="Elegir un día" />
  <a href={hrefDay(addDays(day, 1))} aria-label="Día siguiente">siguiente →</a>
</nav>

<h2 class="day-title">{dayLong(day)}</h2>

{#if error}
  <p class="error">No se pudo leer el día: {error}</p>
{:else if !data}
  <p class="muted">Cargando…</p>
{:else}
  <p class="total">
    <span class="value">{duration(total)}</span> de inmersión
    {#if data.gsm.seconds > 0 && (data.deuchan.seconds ?? 0) > 0}
      ({duration(data.gsm.seconds)} en juegos + {duration(data.deuchan.seconds ?? 0)} en YouTube)
    {/if}
    · {number.format(data.anki.reviews)} repasos · {number.format(data.anki.mined.length)} tarjetas minadas
  </p>

  <section class="card" aria-labelledby="gsm-title">
    <h3 id="gsm-title">
      <span class="swatch gsm" aria-hidden="true"></span>Juegos (GameSentenceMiner): {duration(
        data.gsm.seconds,
      )}
    </h3>
    <p class="note">
      Tiempo de lectura calculado como lo calcula GSM: cada línea suma el tiempo hasta la siguiente, con un
      tope según tu ritmo de esa sesión; un hueco de más de 30 minutos corta la sesión y no cuenta. Entran las
      líneas leídas entre las {data.cutoffHour}:00 de este día y las {data.cutoffHour}:00 del siguiente.
    </p>
    {#if data.gsm.sessions.length === 0}
      <p class="muted">Nada leído en GSM este día.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th scope="col">Juego</th>
            <th scope="col">Horario</th>
            <th scope="col" class="num">Líneas</th>
            <th scope="col" class="num">Caracteres</th>
            <th scope="col" class="num">Tiempo</th>
          </tr>
        </thead>
        <tbody>
          {#each data.gsm.sessions as session (session.id)}
            <tr>
              <td>{session.title ?? "Sin nombre"}</td>
              <td
                >{timeOf(session.start, data.timeZone, data.day)}–{timeOf(
                  session.end,
                  data.timeZone,
                  data.day,
                )}</td
              >
              <td class="num">{number.format(session.lines ?? 0)}</td>
              <td class="num">{number.format(session.characters ?? 0)}</td>
              <td class="num">{duration(session.seconds)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if data.gsm.otherLanguageSeconds > 0}
      <p class="note">
        Además hubo {duration(data.gsm.otherLanguageSeconds)} en sesiones en otro idioma, que no cuentan como inmersión.
      </p>
    {/if}
  </section>

  <section class="card" aria-labelledby="yt-title">
    <h3 id="yt-title">
      <span class="swatch youtube" aria-hidden="true"></span>YouTube (Deuchan): {data.deuchan.seconds === null
        ? "sin datos"
        : duration(data.deuchan.seconds)}
    </h3>
    <p class="note">
      Es lo que muestra el dashboard de Deuchan para este día, con tus correcciones y el tiempo de otras
      computadoras sincronizadas. Deuchan cuenta los días de medianoche a medianoche.
      {#if data.deuchan.snapshotAt}Último dato: {timeOf(
          data.deuchan.snapshotAt,
          data.timeZone,
          data.day,
        )}{/if}
    </p>
    {#if data.deuchan.videos.length > 0}
      <table>
        <thead>
          <tr>
            <th scope="col">Video (de esta computadora)</th>
            <th scope="col" class="num">Tiempo</th>
          </tr>
        </thead>
        <tbody>
          {#each data.deuchan.videos as video (video.videoId)}
            <tr>
              <td>
                <a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">
                  {video.title || video.videoId}
                </a>
              </td>
              <td class="num">{duration(video.seconds)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if data.deuchan.seconds !== null && data.deuchan.seconds > 0}
      <p class="muted">Deuchan no guarda la lista de videos de días de hace más de 60 días.</p>
    {/if}
  </section>

  <section class="card" aria-labelledby="anki-title">
    <h3 id="anki-title">
      <span class="swatch anki" aria-hidden="true"></span>Anki: {number.format(data.anki.reviews)} repasos
    </h3>
    <p class="note">
      Repasos como los cuenta Anki: aprendizaje, repaso, reaprendizaje y filtrado (las reprogramaciones no
      cuentan). El tiempo es el que Anki registró para cada respuesta.
    </p>
    <dl class="facts">
      <div>
        <dt>Tiempo de repaso</dt>
        <dd>{duration(data.anki.seconds)}</dd>
      </div>
      <div>
        <dt>Aprendizaje</dt>
        <dd>{number.format(data.anki.byType.learning)}</dd>
      </div>
      <div>
        <dt>Repaso</dt>
        <dd>{number.format(data.anki.byType.review)}</dd>
      </div>
      <div>
        <dt>Reaprendizaje</dt>
        <dd>{number.format(data.anki.byType.relearning)}</dd>
      </div>
      <div>
        <dt>Tarjetas vistas por primera vez</dt>
        <dd>{number.format(data.anki.newCards)}</dd>
      </div>
    </dl>
    <h4>Tarjetas minadas este día</h4>
    <p class="note">
      Notas creadas este día fuera del mazo de Refold, con el origen que Mosaik les encontró.
    </p>
    {#if data.anki.mined.length === 0}
      <p class="muted">Ninguna.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th scope="col">Palabra</th>
            <th scope="col">Hora</th>
            <th scope="col">Origen</th>
            <th scope="col">De</th>
          </tr>
        </thead>
        <tbody>
          {#each data.anki.mined as card (card.noteId)}
            <tr>
              <td>{card.word ?? "—"}</td>
              <td>{timeOf(card.created, data.timeZone, data.day)}</td>
              <td>{ORIGIN_LABELS[card.origin] ?? card.origin}</td>
              <td>{card.contentTitle ?? card.sourceTitle ?? "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{/if}

<style>
  .day-nav {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 8px;
  }

  .day-nav input {
    font: inherit;
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }

  .day-title {
    font-size: 1.25rem;
    margin: 8px 0 4px;
  }

  /* Sentence case: the date starts with a capital (sábado → Sábado) */
  .day-title::first-letter {
    text-transform: uppercase;
  }

  .total {
    margin: 0 0 16px;
    color: var(--muted);
  }

  .total .value {
    font-size: 1.5rem;
    font-weight: 500;
    color: var(--text);
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 4px;
    font-size: 1rem;
  }

  h4 {
    margin: 16px 0 4px;
    font-size: 0.9375rem;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex: none;
  }

  .swatch.gsm {
    background: var(--series-gsm);
  }

  .swatch.youtube {
    background: var(--series-youtube);
  }

  .swatch.anki {
    background: var(--series-anki);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
    margin: 8px 0 0;
  }

  .facts div {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
  }

  .facts dt {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .facts dd {
    margin: 0;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
</style>
