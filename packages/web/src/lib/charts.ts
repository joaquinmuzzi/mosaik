/**
 * Shared chart settings: thin bars with rounded data ends, a surface gap between stacked segments,
 * recessive axes and grid, a tooltip on every mark, and a legend whenever there are two series.
 */
import type { Theme } from "./Chart.svelte";

/** The page font, named: ECharts measures text with it, and "inherit" would measure with another. */
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function baseOption(theme: Theme, extra: { legend: boolean }) {
  return {
    animation: false,
    textStyle: { fontFamily: FONT, color: theme.muted },
    grid: { left: 8, right: 12, top: extra.legend ? 36 : 12, bottom: 8, containLabel: true },
    legend: extra.legend
      ? {
          top: 0,
          right: 0,
          icon: "roundRect",
          itemWidth: 12,
          itemHeight: 12,
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
    axisLabel: { color: theme.muted, hideOverlap: true },
  };
}

export function valueAxis(theme: Theme, name: string) {
  return {
    type: "value",
    name,
    nameTextStyle: { color: theme.muted, align: "left" },
    splitLine: { lineStyle: { color: theme.grid, opacity: 0.6 } },
    axisLabel: { color: theme.muted },
  };
}

/** A bar series; in a stack, every segment but the top one keeps square ends and a 2px gap. */
export function barSeries(
  theme: Theme,
  name: string,
  color: string,
  data: number[],
  top: boolean,
  stack?: string,
) {
  return {
    type: "bar",
    name,
    stack,
    data,
    barMaxWidth: 18,
    itemStyle: {
      color,
      borderRadius: top ? [4, 4, 0, 0] : 0,
      borderColor: theme.surface,
      borderWidth: stack ? 1 : 0,
    },
    emphasis: { focus: "none" },
    cursor: "pointer",
  };
}
