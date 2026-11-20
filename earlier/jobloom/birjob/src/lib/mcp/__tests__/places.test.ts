/**
 * The place an assistant names, read into the board's city filter (#797): every common
 * spelling of a place, and an answer the assistant can act on for one the filter has not.
 */
import { describe, expect, it } from 'vitest';
import { CITIES } from '@/lib/cities';
import { EXONYMS, readPlace } from '../places';

describe('readPlace', () => {
  it.each([
    ['Bakı', 'baki'], ['Baku', 'baki'], ['baki', 'baki'], ['BAKU', 'baki'], ['Баку', 'baki'],
    ['Bakı şəhəri', 'baki'], ['Baku city', 'baki'], ['Baku, Azerbaijan', 'baki'],
    ['Sumqayıt', 'sumqayit'], ['Sumgait', 'sumqayit'], ['Gəncə', 'gence'], ['Ganja', 'gence'],
    ['Şəki', 'sheki'], ['Sheki', 'sheki'], ['Quba rayonu', 'quba'], ['Xırdalan', 'absheron'],
    ['Mingəçevir', 'mingechevir'], ['Nakhchivan', 'naxchivan'], ['Qarabağ', 'qarabag'],
    ['Gabala', 'qebele'], ['Şamaxı', 'shamaxi'], ['Lənkəran-Astara', 'lenkeran-astara'],
  ])('%s is %s', (input, slug) => {
    expect(readPlace(input)).toMatchObject({ kind: 'city', slug });
  });

  it.each(['Azerbaijan', 'Azərbaycan', 'Азербайджан'])('%s is the whole board', (input) => {
    expect(readPlace(input)).toEqual({ kind: 'country-wide' });
  });

  it.each([['Tashkent', 'UZ'], ['Almaty', 'KZ'], ['İstanbul', 'TR'], ['Tbilisi', 'GE'], ['Bishkek', 'KG']])('%s is a city of %s, for the country filter', (input, country) => {
    expect(readPlace(input)).toEqual({ kind: 'foreign', country });
  });

  it.each(['Narnia', 'London', '', '   ', 'rayon'])('%j is unknown', (input) => {
    expect(readPlace(input)).toEqual({ kind: 'unknown' });
  });

  it('maps every exonym onto a place the board has', () => {
    const slugs = new Set(CITIES.map((c) => c.slug));
    expect(Object.values(EXONYMS).filter((slug) => !slugs.has(slug))).toEqual([]);
  });

  it('reads every place\'s own slug and name back to it', () => {
    for (const city of CITIES) {
      expect(readPlace(city.slug), city.slug).toMatchObject({ kind: 'city', slug: city.slug });
      expect(readPlace(city.label), city.label).toMatchObject({ kind: 'city', slug: city.slug });
    }
  });
});
