import { normalizeLocale } from '../../src/utils/locale';

describe('normalizeLocale', () => {
  it('gives Maestro and Espresso language_REGION', () => {
    for (const framework of ['maestro', 'espresso'] as const) {
      const locale = (v: string) => normalizeLocale(v, framework).locale;
      expect(locale('de_DE')).toBe('de_DE');
      expect(locale('de-de')).toBe('de_DE');
      expect(locale('DE_at')).toBe('de_AT');
      expect(locale('de')).toBe('de_DE');
      expect(locale('en')).toBe('en_US');
      expect(locale('deu')).toBe('de_DE');
      expect(locale('fil')).toBe('fil_PH');
      expect(locale('es-419')).toBe('es_419');
      expect(normalizeLocale('de', framework).language).toBeUndefined();
    }
  });

  it('gives XCUITest a region, with the language when it is implied', () => {
    expect(normalizeLocale('DE', 'xcuitest')).toEqual({ locale: 'DE' });
    expect(normalizeLocale('us', 'xcuitest')).toEqual({ locale: 'US' });
    expect(normalizeLocale('de_AT', 'xcuitest')).toEqual({
      locale: 'AT',
      language: 'de',
    });
    expect(normalizeLocale('fra', 'xcuitest')).toEqual({
      locale: 'FR',
      language: 'fr',
    });
  });

  it('passes anything it does not recognise on unchanged', () => {
    expect(normalizeLocale('zh_Hant_TW', 'maestro').locale).toBe('zh_Hant_TW');
    expect(normalizeLocale('xx', 'maestro').locale).toBe('xx');
    expect(normalizeLocale('qqq', 'xcuitest').locale).toBe('qqq');
  });
});
