/**
 * Locales the way each framework wants them, from whatever the user typed.
 * Maestro and Espresso take language_REGION ("de_DE"); XCUITest takes a
 * region ("DE") with the language as a separate option. A bare language
 * ("de", or the three-letter "deu") gets its most common region. Anything not
 * recognised is passed on unchanged for the API to judge.
 */

/** Three-letter ISO 639-2 codes (both B and T forms) to ISO 639-1. */
const THREE_LETTER: Record<string, string> = {
  ara: 'ar',
  ces: 'cs',
  cze: 'cs',
  chi: 'zh',
  zho: 'zh',
  dan: 'da',
  deu: 'de',
  ger: 'de',
  dut: 'nl',
  nld: 'nl',
  ell: 'el',
  gre: 'el',
  eng: 'en',
  fin: 'fi',
  fra: 'fr',
  fre: 'fr',
  heb: 'he',
  hin: 'hi',
  hun: 'hu',
  ind: 'id',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  may: 'ms',
  msa: 'ms',
  nob: 'nb',
  nor: 'nb',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  rum: 'ro',
  rus: 'ru',
  spa: 'es',
  swe: 'sv',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  vie: 'vi',
};

/** The region a language most often means. */
const DEFAULT_REGION: Record<string, string> = {
  ar: 'SA',
  cs: 'CZ',
  da: 'DK',
  de: 'DE',
  el: 'GR',
  en: 'US',
  es: 'ES',
  fi: 'FI',
  fil: 'PH',
  fr: 'FR',
  he: 'IL',
  hi: 'IN',
  hu: 'HU',
  id: 'ID',
  it: 'IT',
  ja: 'JP',
  ko: 'KR',
  ms: 'MY',
  nb: 'NO',
  nl: 'NL',
  no: 'NO',
  pl: 'PL',
  pt: 'BR',
  ro: 'RO',
  ru: 'RU',
  sv: 'SE',
  th: 'TH',
  tr: 'TR',
  uk: 'UA',
  vi: 'VN',
  zh: 'CN',
};

export type LocaleFramework = 'maestro' | 'espresso' | 'xcuitest';

export interface NormalizedLocale {
  locale: string;
  /** XCUITest only: the language implied by "de_DE" or "deu". */
  language?: string;
}

function language(code: string): string {
  const lower = code.toLowerCase();
  return THREE_LETTER[lower] ?? lower;
}

export function normalizeLocale(
  input: string,
  framework: LocaleFramework,
): NormalizedLocale {
  const raw = input.trim();
  const match = /^([a-z]{2,3})(?:[-_]([a-z]{2}|\d{3}))?$/i.exec(raw);
  if (!match) return { locale: input };
  const [, first, second] = match;

  if (framework === 'xcuitest') {
    if (second) {
      return { locale: second.toUpperCase(), language: language(first) };
    }
    // Two letters are a region already ("DE", "us").
    if (first.length === 2) return { locale: first.toUpperCase() };
    const lang = language(first);
    const region = DEFAULT_REGION[lang];
    return region ? { locale: region, language: lang } : { locale: input };
  }

  const lang = language(first);
  if (second) return { locale: `${lang}_${second.toUpperCase()}` };
  const region = DEFAULT_REGION[lang];
  return region ? { locale: `${lang}_${region}` } : { locale: input };
}
