// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { IDBFactory } from 'fake-indexeddb';
import {
  createScanDraftDb,
  draftLifetimeMs,
  type ScanDraft,
} from './scanDraftDb';
import { createScanDraft, draftDebounceMs } from './scanDraft';
import { createOcrQueue } from './ocrQueue';
import { useScanStore } from '../stores/scan';
const active: ReturnType<typeof createScanDraft>[] = [];
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  );
});
afterEach(() => {
  active.splice(0).forEach((d) => d.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(db = createScanDraftDb(new IDBFactory())) {
  const store = useScanStore();
  const engine = {
    recognize: vi.fn(() => new Promise<null>(() => {})),
    terminate: vi.fn(async () => {}),
  };
  const queue = createOcrQueue(store, engine);
  const controller = createScanDraft(store, queue, db);
  active.push(controller);
  return { store, engine, queue, controller, db };
}
it('debounces edits, saves Pinia values, and flushes the latest text on pagehide', async () => {
  const { store, controller, db } = setup();
  await controller.init();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const save = vi.spyOn(db, 'save');
  store.addPage({ rawText: 'raw', editedText: 'one' });
  const id = store.pages[0]!.id;
  store.updatePage(id, 'two');
  store.updatePage(id, 'three');
  await vi.advanceTimersByTimeAsync(draftDebounceMs - 1);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await controller.flush();
  expect(save).toHaveBeenCalledOnce();
  expect((await db.load()).draft?.pages[0]?.editedText).toBe('three');
  store.updatePage(id, 'four');
  window.dispatchEvent(new Event('pagehide'));
  await controller.flush();
  expect((await db.load()).draft?.pages[0]?.editedText).toBe('four');
});
it('restores only after consent, preserving edits, duplicates, IDs and capture sequence', async () => {
  const { store, controller, db, engine } = setup();
  const pages = [
    {
      id: 'kept',
      pageNumber: 1,
      capturePosition: 4,
      rawText: 'raw',
      editedText: 'my edits',
      correctedText: 'AI text',
      status: 'ready' as const,
      duplicateOf: 'earlier',
      keepDuplicate: true,
    },
  ];
  await db.save(
    {
      version: 1,
      updatedAt: Date.now(),
      expiresAt: Date.now() + draftLifetimeMs,
      pages,
      captureSequence: 9,
      cleanupEnabled: false,
    },
    new Map(),
    (await db.load()).revision,
  );
  await controller.init();
  expect(store.pages).toHaveLength(0);
  expect(controller.previous.value).not.toBeNull();
  expect(engine.recognize).not.toHaveBeenCalled();
  expect(await controller.resume()).toBe(true);
  expect(store.pages).toEqual(pages);
  expect(store.cleanupEnabled).toBe(false);
  store.reservePage([]);
  expect(store.pages[1]?.capturePosition).toBe(10);
});
it('resumes pending OCR with the same ID and marks missing photos as recoverable errors', async () => {
  const { controller, db, store, engine } = setup();
  const pending = (id: string, n: number) => ({
    id,
    pageNumber: n,
    capturePosition: n,
    rawText: '',
    editedText: '',
    status: 'processing' as const,
  });
  const value: ScanDraft = {
    version: 1,
    updatedAt: Date.now(),
    expiresAt: Date.now() + draftLifetimeMs,
    captureSequence: 2,
    cleanupEnabled: true,
    pages: [pending('one', 1), pending('missing', 2)],
  };
  await db.save(
    value,
    new Map([['one', new Blob(['photo'])]]),
    (await db.load()).revision,
  );
  await controller.init();
  await controller.resume();
  expect(engine.recognize).toHaveBeenCalledWith(expect.any(Blob), 'one');
  expect(store.pages.map((p) => p.id)).toEqual(['one', 'missing']);
  expect(store.pages[1]).toMatchObject({
    status: 'error',
    error: expect.stringContaining('rescan'),
  });
});
it('keeps raw/edited text if cleanup was interrupted, without repeating paid OCR', async () => {
  const { controller, db, store, engine } = setup();
  await db.save(
    {
      version: 1,
      updatedAt: Date.now(),
      expiresAt: Date.now() + draftLifetimeMs,
      captureSequence: 1,
      cleanupEnabled: true,
      pages: [
        {
          id: 'one',
          pageNumber: 1,
          rawText: 'raw words',
          editedText: 'user edits',
          ocrCompleted: true,
          status: 'processing',
        },
      ],
    },
    new Map(),
    (await db.load()).revision,
  );
  await controller.init();
  await controller.resume();
  expect(store.pages[0]).toMatchObject({
    status: 'ready',
    rawText: 'raw words',
    editedText: 'user edits',
    cleanupStatus: 'failed',
  });
  expect(engine.recognize).not.toHaveBeenCalled();
});
it('clears explicit starts over despite pending autosaves and late writes', async () => {
  const { controller, db, store } = setup();
  await controller.init();
  store.addPage({ rawText: 'raw', editedText: 'draft' });
  const writing = controller.flush();
  store.clearSession();
  await writing;
  await controller.flush();
  expect((await db.load()).draft).toBeNull();
  store.addPage({ rawText: 'new', editedText: 'new' });
  await controller.flush();
  expect((await db.load()).draft?.pages[0]?.editedText).toBe('new');
});
it('storage failure is visible and never clears the live scan', async () => {
  const { controller, store, db } = setup();
  await controller.init();
  vi.spyOn(db, 'save').mockRejectedValue(new Error('Quota exceeded'));
  store.addPage({ rawText: 'raw', editedText: 'valuable words' });
  await controller.flush();
  expect(store.combinedText).toBe('valuable words');
  expect(controller.error.value).toContain('download');
});
it('keeps only images awaiting OCR or retry, and drops them once text arrives', async () => {
  const { controller, queue, store, db } = setup();
  await controller.init();
  const id = queue.enqueue(new Blob(['photo']), [])!;
  await controller.flush();
  let saved = await db.load();
  expect((await db.images(saved.revision)).size).toBe(1);
  store.recordOcr(id, { rawText: 'words' });
  await controller.flush();
  saved = await db.load();
  expect((await db.images(saved.revision)).size).toBe(0);
});
it('discards a previous draft and its image before starting a new session', async () => {
  const { controller, db } = setup();
  const value: ScanDraft = {
    version: 1,
    updatedAt: Date.now(),
    expiresAt: Date.now() + draftLifetimeMs,
    captureSequence: 0,
    cleanupEnabled: true,
    pages: [],
  };
  await db.save(
    value,
    new Map([['orphan', new Blob(['photo'])]]),
    (await db.load()).revision,
  );
  await controller.init();
  await controller.discard();
  expect(controller.previous.value).toBeNull();
  expect((await db.load()).draft).toBeNull();
});
it('deletes an inactive draft after 24 hours while preserving text still open in Pinia', async () => {
  const { controller, db, store } = setup();
  await controller.init();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  store.addPage({ rawText: 'raw', editedText: 'still open' });
  await controller.flush();
  await vi.advanceTimersByTimeAsync(draftLifetimeMs);
  await controller.flush();
  expect((await db.load()).draft).toBeNull();
  expect(store.combinedText).toBe('still open');
});
it('does not keep expired drafts in the resume prompt', async () => {
  const { controller, db } = setup();
  await db.save(
    {
      version: 1,
      updatedAt: Date.now() - draftLifetimeMs - 1000,
      expiresAt: Date.now() - 1000,
      captureSequence: 0,
      cleanupEnabled: true,
      pages: [],
    },
    new Map(),
    (await db.load()).revision,
  );
  await controller.init();
  expect(controller.previous.value).toBeNull();
});
it('can reopen the retry image cache without reserving duplicate pages', async () => {
  const { controller, db, store, queue } = setup();
  await db.save(
    {
      version: 1,
      updatedAt: Date.now(),
      expiresAt: Date.now() + draftLifetimeMs,
      captureSequence: 8,
      cleanupEnabled: false,
      pages: [
        {
          id: 'retry',
          pageNumber: 1,
          capturePosition: 8,
          rawText: '',
          editedText: '',
          status: 'error',
        },
      ],
    },
    new Map([['retry', new Blob(['photo'])]]),
    (await db.load()).revision,
  );
  await controller.init();
  await controller.resume();
  expect(queue.canRetry('retry')).toBe(true);
  expect(queue.pendingCount.value).toBe(0);
  expect(queue.retry('retry')).toBe(true);
  expect(store.pages).toHaveLength(1);
  expect(store.pages[0]?.capturePosition).toBe(8);
});
it('allows the app to open when IndexedDB is unavailable', async () => {
  const { controller, db } = setup();
  vi.spyOn(db, 'load').mockRejectedValue(new Error('Blocked'));
  await controller.init();
  expect(controller.ready.value).toBe(true);
  expect(controller.error.value).toContain('unavailable');
});
