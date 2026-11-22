/**
 * The immersion chart: bars or lines, per day or per week, per source or per title. Colors come from
 * the theme's tokens and stay fixed per source.
 */
import type { DaySummary } from "@mosaik/shared";
import type { Theme } from "./Chart.svelte";
import { barSeries, baseOption, categoryAxis, valueAxis } from "./charts";
import { type TitleSeries, mondayOf, perWeek, weekKeys } from "./data";
import { dayShort, duration } from "./format";

/** `#rrggbb` mixed with another: `weight` of the first (0-1). ECharts cannot read CSS color-mix(). */
export function mixHex(first: string, second: string, weight: number): string {
  const parse = (hex: string) => {
    const value = hex.trim().replace("#", "");
    const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  };
  const a = parse(first);
  const b = parse(second);
  return `#${a
    .map((channel, i) =>
      Math.round(channel * weight + b[i]! * (1 - weight))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export type Mark = "bars" | "lines";
export type Period = "day" | "week";
export type Split = "source" | "title";

/** Colors for titles: games take the GSM color family, the rest Deuchan's, in steps. */
export function titleColor(
  theme: Pick<Theme, "gsm" | "youtube" | "surface">,
  series: Pick<TitleSeries, "kind">,
  index: number,
): string {
  const base = series.kind === "game" ? theme.gsm : theme.youtube;
  const mix = [100, 70, 45, 85, 60][index % 5] ?? 100;
  return mixHex(base, theme.surface, mix / 100);
}

const shortTitle = (title: string) => (title.length > 38 ? `${title.slice(0, 36)}…` : title);

/** Immersion over time, with the three switches. Minutes per day, or hours per week. */
export function immersionOption(
  theme: Theme,
  days: DaySummary[],
  options: { mark: Mark; period: Period; split: Split; titles?: TitleSeries[]; legend?: boolean },
) {
  const dayKeys = days.map((day) => day.day);
  const byDay = new Map(days.map((day) => [day.day, day]));
  const keys = options.period === "day" ? dayKeys : weekKeys(dayKeys);
  const scale = options.period === "day" ? 60 : 3600;
  const unit = options.period === "day" ? "minutos" : "horas";
  const sum = (value: (day: string) => number) => {
    if (options.period === "day") return keys.map((key) => +(value(key) / scale).toFixed(2));
    const weeks = perWeek(dayKeys, value);
    return keys.map((key) => +((weeks.get(key) ?? 0) / scale).toFixed(2));
  };

  const groups =
    options.split === "title" && options.titles
      ? options.titles.map((series, index) => ({
          name: shortTitle(series.title),
          color: titleColor(theme, series, index),
          values: sum((day) => series.days.get(day) ?? 0),
        }))
      : [
          { name: "Juegos (GSM)", color: theme.gsm, values: sum((day) => byDay.get(day)?.gsmSeconds ?? 0) },
          {
            name: "Deuchan",
            color: theme.youtube,
            values: sum((day) => byDay.get(day)?.deuchanSeconds ?? 0),
          },
        ];

  const labels = keys.map((key) =>
    options.period === "day" ? dayShort(key) : `sem ${dayShort(mondayOf(key))}`,
  );
  const base = baseOption(theme, { legend: options.legend ?? true });
  const series = groups.map((group, index) =>
    options.mark === "bars"
      ? barSeries(theme, group.name, group.color, group.values, index === groups.length - 1, "immersion")
      : {
          type: "line",
          name: group.name,
          data: group.values,
          smooth: 0.25,
          symbol: "circle",
          symbolSize: 6,
          showSymbol: false,
          lineStyle: { width: 2, color: group.color },
          itemStyle: { color: group.color },
        },
  );
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      axisPointer:
        options.mark === "bars"
          ? base.tooltip.axisPointer
          : { type: "line", lineStyle: { color: theme.muted } },
      confine: true,
      valueFormatter: (value: number) =>
        options.period === "day" ? duration(value * 60) : duration(value * 3600),
    },
    xAxis: { ...categoryAxis(theme, labels), boundaryGap: options.mark === "bars" },
    yAxis: valueAxis(theme, unit),
    series,
  };
}

export { barSeries, baseOption, categoryAxis, valueAxis };
