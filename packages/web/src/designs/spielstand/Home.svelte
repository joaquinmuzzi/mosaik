<script lang="ts">
  import { getAnki, getOverview } from "../../lib/api";
  import Chart, { type Theme } from "../../lib/Chart.svelte";
  import { type FeedItem, MILESTONES, immersion, loadFeed } from "../../lib/data";
  import { ORIGIN_LABELS, dayShort, duration, number } from "../../lib/format";
  import Info from "../../lib/Info.svelte";
  import { load } from "../../lib/load.svelte";
  import { NOTES } from "../../lib/notes";
  import { hrefDay } from "../../lib/router.svelte";
  import { immersionOption } from "../../lib/vizkit";

  const year = load(() => getOverview(365));
  const anki = load(getAnki);
  let feed = $state<FeedItem[] | null>(null);
  $effect(() => {
    if (year.data && !feed) void loadFeed(year.data.days, { maxItems: 7 }).then((items) => (feed = items));
  });

  const days = $derived(year.data?.days ?? []);
  const today = $derived(days.at(-1));
  const total = $derived(days.reduce((sum, day) => sum + immersion(day), 0));
  const week = $derived(days.slice(-7).reduce((sum, day) => sum + immersion(day), 0));
  const hours = $derived(total / 3600);
  const next = $derived(MILESTONES.find((milestone) => milestone > hours) ?? MILESTONES.at(-1)!);
  const previous = $derived([...MILESTONES].reverse().find((milestone) => milestone <= hours) ?? 0);
  const progress = $derived(Math.min(1, (hours - previous) / Math.max(next - previous, 1)));
  const origins = $derived(anki.data?.origins ?? []);
  const gem = (origin: string) => `var(--series-${origin === "refold-1k" ? "refold" : origin})`;
  const gemName: Record<string, string> = {
    gsm: "Saphir",
    youtube: "Feuer",
    "refold-1k": "Smaragd",
    unknown: "Stein",
  };

  const chart = $derived((theme: Theme) =>
    immersionOption(theme, days.slice(-30), { mark: "bars", period: "day", split: "source" }),
  );
  const open = (index: number) => {
    const day = days.slice(-30)[index];
    if (day) location.hash = hrefDay(day.day);
  };
  const questIcon = { gsm: "⚔", youtube: "▶", mined: "✦" } as const;
</script>

{#if year.error}
  <p class="error">No se pudo leer el resumen: {year.error}</p>
{:else if !year.data || !today}
  <p class="muted">Cargando…</p>
{:else}
  <section class="s-panel s-hero">
    <div>
      <p class="s-heading">
        Spielzeit <small>tiempo de inmersión del año</small>
        <Info text={`${NOTES.immersion} ${NOTES.year}`} />
      </p>
      <p class="s-time s-num">{duration(total)}</p>
    </div>
    <div class="s-xp">
      <p class="s-heading">
        Nächstes Ziel <small>próximo hito: {next} h</small>
        <Info text={NOTES.milestones} />
      </p>
      <div
        class="s-bar"
        role="progressbar"
        aria-label="Avance hacia el próximo hito"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span style:width={`${progress * 100}%`}></span>
      </div>
      <p class="s-xp-text s-num">{hours.toFixed(1)} / {next} h</p>
    </div>
  </section>

  <section class="s-attrs" aria-label="Estado">
    <a class="s-panel s-attr" href={hrefDay(today.day)}>
      <span class="s-heading">Heute <small>hoy</small></span>
      <span class="s-value s-num">{duration(immersion(today))}</span>
      <span class="s-mini">
        <i style:background="var(--series-gsm)"></i>{duration(today.gsmSeconds)} juego
        <i style:background="var(--series-youtube)"></i>{duration(today.deuchanSeconds ?? 0)} video
      </span>
    </a>
    <div class="s-panel s-attr">
      <span class="s-heading">Woche <small>7 días</small></span>
      <span class="s-value s-num">{duration(week)}</span>
    </div>
    <div class="s-panel s-attr">
      <span class="s-heading">Serie <small>racha</small> <Info text={NOTES.streak} /></span>
      <span class="s-value s-num">🔥 {year.data.streak}</span>
    </div>
    <div class="s-panel s-attr">
      <span class="s-heading">Wiederholung <small>repasos</small> <Info text={NOTES.reviews} /></span>
      <span class="s-value s-num">{number.format(today.reviews)}</span>
      <span class="s-mini">{number.format(today.cardsMined)} minadas hoy</span>
    </div>
  </section>

  <div class="s-row">
    <section class="s-panel">
      <p class="s-heading">Inventar <small>tarjetas por origen</small> <Info text={NOTES.origins} /></p>
      <ul class="s-inventory">
        {#each origins as origin (origin.origin)}
          <li>
            <span class="s-gem" style:--gem={gem(origin.origin)} aria-hidden="true"></span>
            <span class="s-count s-num">{number.format(origin.cards)}</span>
            <span class="s-item"
              >{gemName[origin.origin] ?? origin.origin}<small>{ORIGIN_LABELS[origin.origin]}</small></span
            >
          </li>
        {/each}
      </ul>
    </section>
    <section class="s-panel">
      <p class="s-heading">Questlog <small>actividad reciente</small></p>
      {#if !feed}
        <p class="muted">Cargando…</p>
      {:else}
        <ol class="s-quests">
          {#each feed as item (item.key)}
            <li>
              <span class="s-icon {item.kind}" aria-hidden="true">{questIcon[item.kind]}</span>
              <span class="s-quest"><b>{item.title}</b><span>{item.detail}</span></span>
              <a href={hrefDay(item.day)}>{dayShort(item.day)}</a>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </div>

  <section class="s-panel">
    <p class="s-heading">
      Letzte 30 Tage <small>últimos 30 días</small>
      <Info text={NOTES.day(year.data.cutoffHour)} />
    </p>
    <Chart option={chart} onselect={open} height={210} label="Minutos de inmersión por día, por fuente" />
  </section>
{/if}

<style>
  .s-hero {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    align-items: end;
    margin-bottom: 14px;
  }

  .s-time {
    margin: 0;
    font-size: clamp(2.5rem, 6vw, 3.75rem);
    font-weight: 700;
    line-height: 1;
    color: var(--text);
  }

  .s-bar {
    height: 14px;
    border: 1px solid var(--frame);
    border-radius: 3px;
    background: var(--bg);
    padding: 2px;
  }

  .s-bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: repeating-linear-gradient(90deg, var(--series-mined) 0 10px, #e0a520 10px 12px);
  }

  .s-xp-text {
    margin: 6px 0 0;
    color: var(--muted);
    text-align: right;
  }

  .s-attrs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 14px;
    margin-bottom: 14px;
  }

  .s-attr {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text);
    text-decoration: none;
  }

  .s-attr .s-heading {
    margin-bottom: 4px;
  }

  a.s-attr:hover {
    border-color: var(--accent);
  }

  .s-value {
    font-size: 1.75rem;
    font-weight: 700;
  }

  .s-mini {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .s-mini i {
    width: 8px;
    height: 8px;
    transform: rotate(45deg);
  }

  .s-row {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 14px;
    margin-bottom: 14px;
  }

  .s-inventory {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .s-inventory li {
    display: grid;
    grid-template-columns: 34px 1fr;
    grid-template-rows: auto auto;
    column-gap: 10px;
    align-items: center;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
  }

  .s-gem {
    grid-row: span 2;
    width: 24px;
    height: 24px;
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

  .s-count {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .s-item {
    display: flex;
    flex-direction: column;
    font-size: 0.8125rem;
    color: var(--accent);
  }

  .s-item small {
    color: var(--muted);
  }

  .s-quests {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .s-quests li {
    display: grid;
    grid-template-columns: 26px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px dashed var(--border);
  }

  .s-icon {
    color: var(--series-gsm);
    text-align: center;
  }

  .s-icon.youtube {
    color: var(--series-youtube);
  }

  .s-icon.mined {
    color: var(--series-mined);
  }

  .s-quest {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .s-quest b {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .s-quest span,
  .s-quests a {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  @media (max-width: 1000px) {
    .s-hero,
    .s-row {
      grid-template-columns: 1fr;
    }
  }
</style>
