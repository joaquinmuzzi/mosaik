import { describe, expect, it } from "vitest";
import { titlesTooltip } from "../src/lib/vizkit";

const item = (seriesName: string, value: number) => ({
  axisValueLabel: "16 nov",
  marker: "",
  seriesName,
  value,
});
const format = (value: number) => `${value} min`;

describe("titlesTooltip", () => {
  it("leaves out the titles with nothing", () => {
    const html = titlesTooltip(
      [item("Ein Spiel", 0), item("Ein Video", 12), item("Noch eins", 0.03)],
      format,
    );
    expect(html).toContain("16 nov");
    expect(html).not.toContain("Ein Spiel");
    expect(html).toContain("12 min");
    expect(html).toContain("0.03 min");
  });

  it("says so when none has time", () => {
    expect(titlesTooltip([item("Ein Spiel", 0)], format)).toContain("Nada de estos títulos");
  });

  it("does not take a title as HTML", () => {
    expect(titlesTooltip([item("<img src=x>", 1)], format)).not.toContain("<img");
  });
});
