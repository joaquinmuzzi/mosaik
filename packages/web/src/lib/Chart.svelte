<script lang="ts" module>
  import { BarChart, LineChart, ScatterChart } from "echarts/charts";
  import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
  import * as echarts from "echarts/core";
  import { SVGRenderer } from "echarts/renderers";

  echarts.use([
    BarChart,
    LineChart,
    ScatterChart,
    GridComponent,
    LegendComponent,
    TooltipComponent,
    SVGRenderer,
  ]);

  /** The colors of the current theme, read from the CSS tokens so light and dark stay in one place. */
  export interface Theme {
    gsm: string;
    youtube: string;
    refold: string;
    unknown: string;
    anki: string;
    mined: string;
    accent: string;
    text: string;
    muted: string;
    grid: string;
    surface: string;
  }

  export function readTheme(): Theme {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    return {
      gsm: token("--series-gsm"),
      youtube: token("--series-youtube"),
      refold: token("--series-refold"),
      unknown: token("--series-unknown"),
      anki: token("--series-anki"),
      mined: token("--series-mined") || token("--series-youtube"),
      accent: token("--accent") || token("--series-gsm"),
      text: token("--text"),
      muted: token("--muted"),
      grid: token("--grid"),
      surface: token("--surface"),
    };
  }

  export type EChartsOption = echarts.EChartsCoreOption;
</script>

<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    /** Builds the chart for the current theme. */
    option: (theme: Theme) => EChartsOption;
    /** Called with the index of the category clicked: anywhere in its column, not only on a mark. */
    onselect?: (index: number) => void;
    height?: number;
    label: string;
  }

  let { option, onselect, height = 260, label }: Props = $props();
  let element: HTMLDivElement;
  let chart: echarts.ECharts | undefined;

  function render() {
    chart?.setOption(option(readTheme()), { notMerge: true });
  }

  onMount(() => {
    chart = echarts.init(element, null, { renderer: "svg" });
    const zr = chart.getZr();
    const inside = (event: { offsetX: number; offsetY: number }) =>
      onselect !== undefined && chart!.containPixel("grid", [event.offsetX, event.offsetY]);
    zr.on("click", (event) => {
      if (!inside(event)) return;
      const index = chart!.convertFromPixel({ xAxisIndex: 0 }, event.offsetX);
      if (Number.isInteger(index) && index >= 0) onselect?.(index);
    });
    zr.on("mousemove", (event) => {
      if (inside(event)) zr.setCursorStyle("pointer");
    });
    render();
    const resize = new ResizeObserver(() => chart?.resize());
    resize.observe(element);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", render);
    return () => {
      resize.disconnect();
      scheme.removeEventListener("change", render);
      chart?.dispose();
    };
  });

  $effect(() => {
    // Re-render when the option builder (and so its data) changes
    void option;
    render();
  });
</script>

<div bind:this={element} class="chart" style:height={`${height}px`} role="img" aria-label={label}></div>

<style>
  .chart {
    width: 100%;
  }
</style>
