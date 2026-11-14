import { describe, expect, it } from "vitest";
import {
  cleanSourceTitle,
  decodeEntities,
  fieldValues,
  plainText,
  sourceTitleOf,
  wordOf,
} from "../src/connectors/anki/text.ts";

const field = (value: string) => ({ value });

describe("cleanSourceTitle", () => {
  it("drops what the browser adds to a YouTube tab title", () => {
    expect(cleanSourceTitle("(3) Easy German 412 - Im Supermarkt - YouTube")).toBe(
      "Easy German 412 - Im Supermarkt",
    );
    expect(cleanSourceTitle("(99+) Nachrichten - YouTube")).toBe("Nachrichten");
  });

  it("keeps dashes and parentheses that belong to the title", () => {
    expect(cleanSourceTitle("Let's Play Beispiel #002 [Deutsch] - Der Anfang")).toBe(
      "Let's Play Beispiel #002 [Deutsch] - Der Anfang",
    );
    expect(cleanSourceTitle("Kochen (Teil 2) - YouTube")).toBe("Kochen (Teil 2)");
  });

  it("removes HTML, entities and the invisible marks around @names", () => {
    expect(cleanSourceTitle('<span data-group-id="1">Let&#x27;s Play &amp; Spaß</span>')).toBe(
      "Let's Play & Spaß",
    );
    expect(cleanSourceTitle("Reaktion (ft. ⁨@Jemand⁩ ) - YouTube")).toBe("Reaktion (ft. @Jemand )");
  });

  it("leaves a game name as it is", () => {
    expect(cleanSourceTitle("Beispiel Spiel: Teil Eins")).toBe("Beispiel Spiel: Teil Eins");
  });
});

describe("decodeEntities / plainText", () => {
  it("decodes named, decimal and hex entities and leaves unknown ones", () => {
    expect(decodeEntities("&lt;b&gt; &#252; &#xFC; &quot;x&quot; &bogus;")).toBe('<b> ü ü "x" &bogus;');
  });

  it("strips tags, sounds and line breaks", () => {
    expect(plainText("<b>sein</b>&nbsp;<br>[sound:sein.mp3]")).toBe("sein");
  });
});

describe("wordOf", () => {
  it("reads the field each note type uses", () => {
    expect(wordOf("Kiku", { Expression: field("Brücke"), Sentence: field("…") })).toBe("Brücke");
    expect(wordOf("Kiku Deutsch", { Expression: field("<b>Fenster</b>") })).toBe("Fenster");
    expect(wordOf("Alemán-mil", { "Índice de ordenación": field("2"), Palabra: field("<b>sein</b>") })).toBe(
      "sein",
    );
  });

  it("falls back to usual field names for other note types", () => {
    expect(wordOf("Basic", { Front: field("Haus"), Back: field("house") })).toBe("Haus");
    expect(wordOf("Kiku", { Expression: field(""), Word: field("Baum") })).toBe("Baum");
    expect(wordOf("Basic", { Back: field("house") })).toBeNull();
  });
});

describe("sourceTitleOf", () => {
  it("reads MiscInfo, or Source, cleaned", () => {
    expect(sourceTitleOf({ MiscInfo: field("(1) Video - YouTube") })).toBe("Video");
    expect(sourceTitleOf({ Source: field("Ein Buch") })).toBe("Ein Buch");
    expect(sourceTitleOf({ MiscInfo: field(""), Expression: field("x") })).toBeNull();
  });
});

describe("fieldValues", () => {
  it("keeps the values in field order", () => {
    expect(
      Object.keys(
        fieldValues({
          B: { value: "2", order: 1 },
          A: { value: "1", order: 0 },
          C: { value: "3", order: 2 },
        }),
      ),
    ).toEqual(["A", "B", "C"]);
  });
});
