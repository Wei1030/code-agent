/**
 * The character shown in a person's avatar: the first letter or digit of their name, taken as a
 * whole character as people read it (one grapheme: "张伟" gives 张, a decomposed "é" stays one
 * character, a Devanagari letter keeps its vowel sign), upper-cased in scripts that have cases.
 * Punctuation, symbols and emoji in front are skipped; '' when the name has no letter or digit.
 */
export function initialOf(name: string): string {
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name.normalize('NFC'));
  for (const { segment } of graphemes) {
    if (/^[\p{L}\p{N}]/u.test(segment)) return segment.toLocaleUpperCase();
  }
  return '';
}
