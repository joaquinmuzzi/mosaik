import { describe, expect, it } from "vitest";
import { countWords } from "../src/words.ts";

describe("countWords", () => {
  it("counts the words of a sentence, without its punctuation", () => {
    expect(countWords("Zum Glück bin ich pünktlich.")).toBe(5);
    expect(countWords('„Nein!“, sagte er … – "Doch"')).toBe(4);
    expect(countWords("")).toBe(0);
    expect(countWords(" … — !? ")).toBe(0);
  });

  it("takes what is inside a word as part of it", () => {
    expect(countWords("Wie geht's? Schick mir 'ne E-Mail, Bahn- und Busfahrer.")).toBe(9);
    expect(countWords("Es kostet 3,50 Euro um 20:15 Uhr")).toBe(7);
    // A decomposed umlaut
    expect(countWords("u\u0308ber")).toBe(1);
  });

  it("separates the lines of a text box", () => {
    expect(countWords("Einspruch\nEuer Ehren")).toBe(3);
  });
});
