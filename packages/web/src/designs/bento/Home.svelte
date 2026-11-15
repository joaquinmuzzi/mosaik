<script lang="ts">
  import { getAnki, getContents, getOverview } from "../../lib/api";
  import Chart, { type Theme } from "../../lib/Chart.svelte";
  import Cover from "../../lib/Cover.svelte";
  import { immersion, minedTotals, rate } from "../../lib/data";
  import { ORIGIN_LABELS, dayShort, duration, number, percent } from "../../lib/format";
  import Info from "../../lib/Info.svelte";
  import { load } from "../../lib/load.svelte";
  import { FEW_ANSWERS, NOTES } from "../../lib/notes";
  import { hrefContent, hrefDay } from "../../lib/router.svelte";
  import { donutOption, immersionOption } from "../../lib/vizkit";

  const overview = load(() => getOverview(30));
  const anki = load(getAnki);
  const contents = load(getContents);

  const days = $derived(overview.data?.days ?? []);
  const today = $derived(days.at(-1));
  const fortnight = $derived(days.slice(-14));
  const week = $derived(days.slice(-7));
  const maxWeekReviews = $derived(Math.max(1, ...week.map((day) => day.reviews)));
  const origins = $derived(anki.data?.origins ?? []);
  const refold = $derived(origins.find((origin) => origin.origin === "refold-1k"));
  const mined = $derived(minedTotals(origins));
  const recent = $derived((contents.data?.contents ?? []).slice(0, 3));
  const show = (value: number | null) => (value === null ? "—" : percent.format(value));

  const share = $derived.by(() => {
    if (!today) return { gsm: 0, youtube: 0 };
    const total = Math.max(1, immersion(today));
    return { gsm: (today.gsmSeconds / total) * 100, youtube: ((today.deuchanSeconds ?? 0) / total) * 100 };
  });

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
    ),
  );
  const chart = $derived((theme: Theme) =>
    immersionOption(theme, days, { mark: "bars", period: "day", split: "source" }),
  );
  const open = (index: number) => {
    const day = days[index];
    if (day) location.hash = hrefDay(day.day);
  };
</script>

{#if overview.error}
  <p class="error">No se pudo leer el resumen: {overview.error}</p>
{:else if !overview.data || !today}
  <p class="muted">Cargando…</p>
{:else}
  <div class="b-grid">
    <a class="b-cell s-5 r-2 b-today" href={hrefDay(today.day)}>
      <p class="b-q">
        ¿Cuánto hice hoy? <Info text={`${NOTES.immersion} ${NOTES.day(overview.data.cutoffHour)}`} />
      </p>
      <span class="b-big b-huge">{duration(immersion(today))}</span>
      <div class="b-split" aria-hidden="true">
        <span style:width={`${share.gsm}%`} style:background="var(--series-gsm)"></span>
        <span style:width={`${share.youtube}%`} style:background="var(--series-youtube)"></span>
      </div>
      <p class="b-legend">
        <span><i style:background="var(--series-gsm)"></i>Juegos {duration(today.gsmSeconds)}</span>
        <span
          ><i style:background="var(--series-youtube)"></i>YouTube {duration(today.deuchanSeconds ?? 0)}</span
        >
      </p>
      <p class="b-sub b-bottom">
        Esta semana: <b>{duration(week.reduce((sum, day) => sum + immersion(day), 0))}</b>
      </p>
    </a>

    <div class="b-cell s-3">
      <p class="b-q">¿Sigo en racha? <Info text={NOTES.streak} /></p>
      <span class="b-big"
        >{overview.data.streak} <small>{overview.data.streak === 1 ? "día" : "días"}</small></span
      >
      <div class="b-dots" aria-label="Últimos 14 días con o sin inmersión">
        {#each fortnight as day (day.day)}
          <span class:on={immersion(day) > 0} title={dayShort(day.day)}></span>
        {/each}
      </div>
    </div>

    <div class="b-cell s-4">
      <p class="b-q">¿Cuánto repasé? <Info text={NOTES.reviews} /></p>
      <span class="b-big">{number.format(today.reviews)} <small>hoy</small></span>
      <div class="b-mini" aria-hidden="true">
        {#each week as day (day.day)}
          <span style:height={`${(day.reviews / maxWeekReviews) * 100}%`}></span>
        {/each}
      </div>
    </div>

    <div class="b-cell s-3">
      <p class="b-q">¿Miné algo hoy? <Info text={NOTES.mined} /></p>
      <span class="b-big">{number.format(today.cardsMined)} <small>tarjetas</small></span>
    </div>

    <div class="b-cell s-4">
      <p class="b-q">¿Cómo va mi retención? <Info text={NOTES.retention(FEW_ANSWERS)} /></p>
      <div class="b-ret">
        <div>
          <span class="b-big">{show(refold ? rate(refold.young) : null)}</span>
          <span class="b-sub">Refold, jóvenes</span>
        </div>
        <div class:dim={mined.young.reviews < FEW_ANSWERS}>
          <span class="b-big">{show(rate(mined.young))}</span>
          <span class="b-sub">minadas ({number.format(mined.young.reviews)})</span>
        </div>
      </div>
    </div>

    <div class="b-cell s-4">
      <p class="b-q">¿De dónde salen mis tarjetas? <Info text={NOTES.origins} /></p>
      <div class="b-donut">
        <Chart option={donut} height={130} label="Tarjetas por origen" />
        <ul>
          {#each origins as origin (origin.origin)}
            <li>
              <i
                style:background={`var(--series-${origin.origin === "refold-1k" ? "refold" : origin.origin})`}
              ></i>{ORIGIN_LABELS[origin.origin]} <b>{number.format(origin.cards)}</b>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <div class="b-cell s-4 b-later">
      <p class="b-q">¿Qué estoy jugando o mirando?</p>
      <ul class="b-recent">
        {#each recent as content (content.id)}
          <li>
            <a href={hrefContent(content.id)}>
              <span class="b-thumb"><Cover {content} /></span>
              <span class="b-rtext"
                ><b>{content.title ?? content.id}</b><span class="b-sub">{duration(content.seconds)}</span
                ></span
              >
            </a>
          </li>
        {/each}
      </ul>
    </div>

    <div class="b-cell s-8 r-2 b-chart">
      <p class="b-q">¿Cómo vienen los últimos 30 días?</p>
      <Chart option={chart} onselect={open} height={240} label="Minutos de inmersión por día, por fuente" />
    </div>
  </div>
{/if}

<style>
  .b-huge {
    font-size: clamp(3rem, 6vw, 4.5rem);
  }

  .b-split {
    display: flex;
    gap: 3px;
    height: 12px;
    margin: 16px 0 10px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface-2);
  }

  .b-split span {
    height: 100%;
  }

  .b-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin: 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .b-legend i,
  .b-donut i {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 2px;
  }

  .b-bottom {
    margin: auto 0 0;
    padding-top: 16px;
  }

  .b-bottom b {
    color: var(--text);
  }

  .b-dots {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
    margin-top: 12px;
  }

  .b-dots span {
    aspect-ratio: 1;
    border-radius: 4px;
    background: var(--surface-2);
  }

  .b-dots span.on {
    background: var(--accent);
  }

  .b-mini {
    display: flex;
    align-items: flex-end;
    gap: 5px;
    height: 44px;
    margin-top: auto;
  }

  .b-mini span {
    flex: 1;
    min-height: 2px;
    border-radius: 3px 3px 0 0;
    background: var(--series-anki);
  }

  .b-ret {
    display: flex;
    gap: 24px;
  }

  .b-ret div {
    display: flex;
    flex-direction: column;
  }

  .b-ret .dim .b-big {
    color: var(--muted);
  }

  .b-donut {
    display: grid;
    grid-template-columns: 120px 1fr;
    align-items: center;
    gap: 10px;
  }

  .b-donut ul,
  .b-recent {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 0.8125rem;
  }

  .b-donut b {
    float: right;
  }

  .b-recent a {
    display: grid;
    grid-template-columns: 40px 1fr;
    align-items: center;
    gap: 10px;
    color: var(--text);
    text-decoration: none;
  }

  .b-thumb {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    overflow: hidden;
  }

  .b-rtext {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .b-rtext b {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The 30-day chart sits beside the donut, two rows tall, and what I am playing goes under the donut */
  .b-chart {
    order: 1;
  }

  .b-later {
    order: 2;
  }

  .b-today:hover {
    border-color: var(--accent);
  }
</style>
