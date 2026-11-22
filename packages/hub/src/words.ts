/**
 * Words as a reader counts them: letters and digits, with the apostrophes and hyphens inside them
 * ("geht's", "E-Mail", "3,5" is one word each). Mosaik shows words, which is how reading in a language
 * with spaces is measured; GSM's reading time goes on counting characters (connectors/gsm/reading-time.ts).
 */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’‑-][\p{L}\p{M}\p{N}]+|[.,:]\p{N}+)*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}
