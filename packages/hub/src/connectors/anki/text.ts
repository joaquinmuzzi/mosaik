/**
 * Reading what matters out of a note's fields, which hold HTML as Anki and Yomitan write it.
 */

/** Where each note type keeps the mined word. Unknown types fall back to the usual names. */
const WORD_FIELDS: Record<string, string> = {
  Kiku: "Expression",
  "Kiku Deutsch": "Expression",
  "Alemán-mil": "Palabra",
};
const FALLBACK_WORD_FIELDS = ["Expression", "Word", "Palabra", "Front"];

/**
 * Where the source of a mined card is written. Yomitan's `{document-title}` goes to `MiscInfo` in the
 * Kiku note types; GameSentenceMiner writes the game's name there too.
 */
const SOURCE_FIELDS = ["MiscInfo", "Source"];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/** Plain text of a field: no tags, no `[sound:…]`, entities decoded, spaces collapsed. */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/\[sound:[^\]]*\]/g, ""),
  )
    .replace(/[⁦-⁩‎‏]/g, "") // bidi isolates that YouTube puts around @names
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The title of the page a card was mined from, without what the browser adds around it:
 * the unread-notifications counter (`(15) …`) and the ` - YouTube` suffix.
 */
export function cleanSourceTitle(raw: string): string {
  return plainText(raw)
    .replace(/^\(\d+\+?\)\s+/, "")
    .replace(/\s+-\s+YouTube$/, "")
    .trim();
}

type Fields = Record<string, { value: string }>;

function firstPresent(fields: Fields, names: string[]): string | null {
  for (const name of names) {
    const value = fields[name]?.value;
    if (value !== undefined && plainText(value) !== "") {
      return value;
    }
  }
  return null;
}

/** The mined word of a note, or `null` if it has none. */
export function wordOf(modelName: string, fields: Fields): string | null {
  const preferred = WORD_FIELDS[modelName];
  const raw = firstPresent(fields, preferred ? [preferred, ...FALLBACK_WORD_FIELDS] : FALLBACK_WORD_FIELDS);
  return raw === null ? null : plainText(raw);
}

/** Where the note says it came from (a video or page title, a game), or `null`. */
export function sourceTitleOf(fields: Fields): string | null {
  const raw = firstPresent(fields, SOURCE_FIELDS);
  return raw === null ? null : cleanSourceTitle(raw) || null;
}

/** `{ name: value }` with the fields in their order, as stored in `raw_anki_notes.fields`. */
export function fieldValues(
  fields: Record<string, { value: string; order: number }>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([name, { value }]) => [name, value]),
  );
}
