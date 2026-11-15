/**
 * Chart builders the designs share: a yearly heatmap, a donut, and an immersion chart that can be
 * bars or lines, per day or per week, per source or per title. Each design passes its own theme, so
 * colors come from its tokens and stay fixed per source.
 */
import type { DaySummary } from "@mosaik/shared";
import type { EChartsOption, Theme } from "./Chart.svelte";
import { barSeries, baseOption, categoryAxis, valueAxis } from "./charts";
import { type TitleSeries, immersion, mondayOf, perWeek, weekKeys } from "./data";
import { dayShort, duration, minutes } from "./format";

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

/** One year of immersion as a calendar heatmap, one hue from the surface to the accent. */
export function heatmapOption(theme: Theme, days: DaySummary[], color = theme.accent): EChartsOption {
  const values = days.map((day) => [day.day, minutes(immersion(day))] as [string, number]);
  const max = Math.max(30, ...values.map(([, value]) => value));
  return {
    animation: false,
    tooltip: {
      backgroundColor: theme.surface,
      borderColor: theme.grid,
      textStyle: { color: theme.text },
      formatter: (item: { value: [string, number] }) =>
        `<b>${dayShort(item.value[0])}</b><br>${item.value[1] > 0 ? duration(item.value[1] * 60) : "Sin inmersión"}`,
    },
    visualMap: {
      show: false,
      min: 0,
      max,
      inRange: { color: [mixHex(color, theme.surface, 0.22), color] },
    },
    calendar: {
      range: [days[0]?.day ?? "", days.at(-1)?.day ?? ""],
      top: 22,
      left: 34,
      right: 8,
      bottom: 4,
      cellSize: ["auto", 13],
      splitLine: { show: false },
      // Empty days stay visible as a faint cell, so the year reads as a grid
      itemStyle: {
        color: mixHex(theme.grid, theme.surface, 0.55),
        borderColor: theme.surface,
        borderWidth: 3,
      },
      yearLabel: { show: false },
      monthLabel: {
        color: theme.muted,
        nameMap: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
      },
      dayLabel: { color: theme.muted, firstDay: 1, nameMap: ["D", "L", "M", "M", "J", "V", "S"] },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: values.map(([day, value]) => [day, value > 0 ? value : null]),
        itemStyle: { borderRadius: 3, borderColor: theme.surface, borderWidth: 2 },
      },
    ],
  };
}

export interface DonutItem {
  name: string;
  value: number;
  color: string;
}

/** A donut with a gap between slices; the tooltip says the value with `format`. */
export function donutOption(
  theme: Theme,
  items: DonutItem[],
  format: (value: number) => string,
  center?: string,
): EChartsOption {
  return {
    animation: false,
    tooltip: {
      backgroundColor: theme.surface,
      borderColor: theme.grid,
      textStyle: { color: theme.text },
      formatter: (item: { name: string; value: number; percent: number }) =>
        `<b>${item.name}</b><br>${format(item.value)} · ${Math.round(item.percent)} %`,
    },
    title: center
      ? {
          text: center,
          left: "center",
          top: "center",
          textStyle: { color: theme.text, fontSize: 18, fontWeight: 600 },
        }
      : undefined,
    series: [
      {
        type: "pie",
        radius: ["58%", "82%"],
        avoidLabelOverlap: true,
        label: { show: false },
        itemStyle: { borderColor: theme.surface, borderWidth: 3, borderRadius: 4 },
        data: items
          .filter((item) => item.value > 0)
          .map((item) => ({ name: item.name, value: item.value, itemStyle: { color: item.color } })),
      },
    ],
  };
}

export type Mark = "bars" | "lines";
export type Period = "day" | "week";
export type Split = "source" | "title";

/** Colors for titles: games take the GSM color family, videos the YouTube one, in steps. */
function titleColor(theme: Theme, series: TitleSeries, index: number): string {
  const base = series.kind === "video" ? theme.youtube : theme.gsm;
  const mix = [100, 70, 45, 85, 60][index % 5] ?? 100;
  return mixHex(base, theme.surface, mix / 100);
}

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
          name: series.title.length > 38 ? `${series.title.slice(0, 36)}…` : series.title,
          color: titleColor(theme, series, index),
          values: sum((day) => series.days.get(day) ?? 0),
        }))
      : [
          { name: "Juegos (GSM)", color: theme.gsm, values: sum((day) => byDay.get(day)?.gsmSeconds ?? 0) },
          {
            name: "YouTube (Deuchan)",
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
      valueFormatter: (value: number) =>
        options.period === "day" ? duration(value * 60) : duration(value * 3600),
    },
    xAxis: { ...categoryAxis(theme, labels), boundaryGap: options.mark === "bars" },
    yAxis: valueAxis(theme, unit),
    series,
  };
}

export { barSeries, baseOption, categoryAxis, valueAxis };
