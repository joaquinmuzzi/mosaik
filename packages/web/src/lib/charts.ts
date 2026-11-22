/**
 * Shared chart settings: thin bars with square ends, a surface gap between stacked segments,
 * recessive axes and grid, a tooltip on every mark, and a legend whenever there are two series.
 */
import type { Theme } from "./Chart.svelte";

/** The page font, named: ECharts measures text with it, and "inherit" would measure with another. */
const FONT = '"Geist Variable", "Segoe UI", system-ui, sans-serif';
/** Axis labels and other figures: muted, in the mono partner. */
export const MONO = '"Geist Mono Variable", ui-monospace, Consolas, monospace';

export function baseOption(theme: Theme, extra: { legend: boolean }) {
  return {
    animation: false,
    textStyle: { fontFamily: FONT, color: theme.muted },
    grid: { left: 8, right: 12, top: extra.legend ? 36 : 28, bottom: 8, containLabel: true },
    legend: extra.legend
      ? {
          top: 0,
          right: 0,
          icon: "roundRect",
          itemWidth: 8,
          itemHeight: 8,
          itemGap: 16,
          textStyle: { color: theme.text, fontFamily: FONT },
        }
      : { show: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: theme.grid, opacity: 0.4 } },
      backgroundColor: theme.surface,
      borderColor: theme.grid,
      textStyle: { color: theme.text },
    },
  };
}

export function categoryAxis(theme: Theme, labels: string[]) {
  return {
    type: "category",
    data: labels,
    axisLine: { lineStyle: { color: theme.grid } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, hideOverlap: true, fontFamily: MONO, fontSize: 11 },
  };
}

export function valueAxis(theme: Theme, name: string) {
  return {
    type: "value",
    name,
    nameTextStyle: { color: theme.muted, align: "left", fontFamily: MONO, fontSize: 11 },
    splitLine: { lineStyle: { color: theme.grid } },
    axisLabel: { color: theme.muted, fontFamily: MONO, fontSize: 11 },
  };
}

/** A bar series, with square ends; in a stack, its segments have a 2px gap. */
export function barSeries(theme: Theme, name: string, color: string, data: number[], stack?: string) {
  return {
    type: "bar",
    name,
    stack,
    data,
    barMaxWidth: 18,
    itemStyle: {
      color,
      borderColor: theme.surface,
      borderWidth: stack ? 1 : 0,
    },
    emphasis: { focus: "none" },
    cursor: "pointer",
  };
}
