import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeSearch } from '../searchText';

describe('normalizeSearch (#720)', () => {
  it.each([
    ['İÇƏRİŞƏHƏR', 'iceriseher'], ['Bakı', 'baki'], ['Şüvəlan', 'suvelan'], ['Kotal qәs.', 'kotal qes'],
    ['Гянджлик Молл', 'гянджлик молл'], ['Ёлка, Йод', 'елка иод'], ['  28-May m/st. ', '28 may m st'],
  ])('folds %s for a Latin keyboard, Cyrillic kept', (input, expected) => {
    expect(normalizeSearch(input)).toBe(expected);
  });

  it('joins a word an apostrophe splits, whichever apostrophe it is', () => {
    // "papa johns" found none of the six Papa John's: "john's" folded to "john s".
    for (const name of ["Papa John's", 'Papa John’s', 'Papa Johnʼs', 'Papa John‘s', 'Papa John`s', 'Papa John´s']) {
      expect(normalizeSearch(name), name).toBe('papa johns');
    }
    expect(normalizeSearch("McDonald's")).toBe(normalizeSearch('McDonalds'));
  });

  it('writes its letters as escapes, so that a look-alike cannot hide in the code', () => {
    // ə and the Cyrillic ә sat side by side in one character class, and the combining
    // marks' range was two invisible characters.
    const source = readFileSync(fileURLToPath(new URL('../searchText.ts', import.meta.url)), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code.match(/[^\x00-\x7f]/g)).toBeNull();
  });
});
