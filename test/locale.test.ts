import { translator } from '../src/locale';
it('ships English, Czech, Slovak and Polish without remote language assets', () => {
  expect(
    ['en', 'cs', 'sk', 'pl'].map((locale) =>
      translator({ locale })('toolbar.save')
    )
  ).toEqual(['Save', 'Uložit', 'Uložiť', 'Zapisz']);
  expect(translator({ locale: 'cs-CZ' })('toolbar.save')).toBe('Uložit');
  expect(translator({ locale: 'fr' })('toolbar.save')).toBe('Save');
  expect(translator({})('toolbar.save')).toBe('Save');
});
it('applies host overrides before built-in language fallbacks', () => {
  const translations = {
    'cs-CZ': { 'image_editor.toolbar.save': 'Potvrdit' },
    cs: { 'image_editor.toolbar.cancel': 'Zavřít' },
  };
  const t = translator({ locale: 'cs-CZ', translations });
  expect(t('toolbar.save')).toBe('Potvrdit');
  expect(t('toolbar.cancel')).toBe('Zavřít');
  expect(t('unknown')).toBe('unknown');
});
