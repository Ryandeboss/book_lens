import { visualSignature } from '../services/pageFingerprint';
import { scannerConfig } from '../config/scanner';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useScanStore } from './scan';

beforeEach(() => setActivePinia(createPinia()));
describe('scan session', () => {
  it('retains raw OCR while edits and combined text use edited values', () => {
    const store = useScanStore();
    store.addPage({
      rawText: 'raw one',
      editedText: 'edited one',
      confidence: 91,
    });
    store.addPage({ rawText: 'raw two', editedText: 'edited two' });
    expect(store.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(store.currentPageNumber).toBe(3);
    expect(store.pages[0]?.id).not.toBe(store.pages[1]?.id);
    store.updatePage(store.pages[0]!.id, 'Café — corrected\nparagraph');
    expect(store.pages[0]?.rawText).toBe('raw one');
    expect(store.pages[0]?.confidence).toBe(91);
    expect(store.combinedText).toBe(
      'Café — corrected\nparagraph\n\n\nedited two',
    );
  });
  it('renumbers deletion, appends correctly, and clears all session state', () => {
    const store = useScanStore();
    for (const text of ['one', 'two', 'three'])
      store.addPage({ rawText: text, editedText: text });
    store.removePage(store.pages[1]!.id);
    expect(
      store.pages.map((page) => [page.pageNumber, page.editedText]),
    ).toEqual([
      [1, 'one'],
      [2, 'three'],
    ]);
    store.addPage({ rawText: 'four', editedText: 'four' });
    expect(store.pages[2]?.pageNumber).toBe(3);
    store.clearSession();
    expect(store.pages).toEqual([]);
    expect(store.currentPageNumber).toBe(1);
    expect(store.combinedText).toBe('');
  });
});

it('bounds fingerprint history and releases it on clear without removing older OCR', () => {
  const store = useScanStore();
  for (let i = 0; i < 20; i++) {
    const fingerprint = visualSignature(Array(40 * 56).fill(i), 40, 56);
    const id = store.reservePage(fingerprint.gray, {
      ...fingerprint,
      features: {
        points: [{ x: 0.5, y: 0.5 }],
        descriptors: new Uint8Array(32),
      },
    });
    store.completePage(id, {
      rawText: 'Page ' + i,
      ocrProvider: 'google-document-ai',
    });
  }
  expect(store.pages.filter((p) => p.visualFingerprint)).toHaveLength(
    scannerConfig.recentFingerprints,
  );
  expect(store.pages.filter((p) => p.fingerprint)).toHaveLength(
    scannerConfig.recentFingerprints,
  );
  expect(store.pages[0]?.rawText).toBe('Page 0');
  store.clearSession();
  expect(store.pages).toEqual([]);
});
