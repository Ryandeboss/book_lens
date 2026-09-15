// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  createScanDraftDb,
  draftLifetimeMs,
  DraftConflict,
  type ScanDraft,
} from './scanDraftDb';
const opened: ReturnType<typeof createScanDraftDb>[] = [];
function setup(factory = new IDBFactory()) {
  const db = createScanDraftDb(factory, 'test');
  opened.push(db);
  return db;
}
const draft = (): ScanDraft => ({
  version: 1,
  updatedAt: Date.now(),
  expiresAt: Date.now() + draftLifetimeMs,
  captureSequence: 7,
  cleanupEnabled: false,
  pages: [
    {
      id: 'page-7',
      pageNumber: 1,
      capturePosition: 7,
      rawText: '',
      editedText: '',
      status: 'queued',
    },
  ],
});
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
  vi.restoreAllMocks();
});
it('recovers text and binary images in a new database connection', async () => {
  const factory = new IDBFactory(),
    db = setup(factory),
    value = draft();
  const initial = await db.load();
  const revision = await db.save(
    value,
    new Map([['page-7', new Blob(['photo'], { type: 'image/jpeg' })]]),
    initial.revision,
  );
  const restarted = setup(factory);
  expect((await restarted.load()).draft).toEqual(value);
  expect(await (await restarted.images(revision)).get('page-7')!.text()).toBe(
    'photo',
  );
});
it('deletes expired metadata and images at the 24-hour boundary', async () => {
  const db = setup(),
    value = draft(),
    initial = await db.load();
  const oldRevision = await db.save(
    value,
    new Map([['page-7', new Blob(['photo'])]]),
    initial.revision,
  );
  expect((await db.load(value.expiresAt - 1)).draft).not.toBeNull();
  const expired = await db.load(value.expiresAt);
  expect(expired.draft).toBeNull();
  expect(expired.revision).not.toBe(oldRevision);
  await expect(db.save(value, new Map(), oldRevision)).rejects.toBeInstanceOf(
    DraftConflict,
  );
  const revision = await db.save(draft(), new Map(), expired.revision);
  expect((await db.images(revision)).size).toBe(0);
});
it('prunes completed images and does not rewrite existing blobs for text edits', async () => {
  const db = setup(),
    initial = await db.load(),
    value = draft(),
    image = new Blob(['photo']);
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  let revision = await db.save(
    value,
    new Map([['page-7', image]]),
    initial.revision,
  );
  revision = await db.save(
    { ...value, cleanupEnabled: true },
    new Map([['page-7', image]]),
    revision,
  );
  expect(put.mock.calls.filter(([v]) => v instanceof Blob)).toHaveLength(1);
  revision = await db.save(
    {
      ...value,
      pages: [
        {
          ...value.pages[0]!,
          status: 'ready',
          rawText: 'words',
          editedText: 'edited',
        },
      ],
    },
    new Map(),
    revision,
  );
  expect((await db.images(revision)).size).toBe(0);
});
it('explicit clearing prevents a stale tab from recreating the draft', async () => {
  const db = setup(),
    initial = await db.load();
  const revision = await db.save(
    draft(),
    new Map([['page-7', new Blob(['photo'])]]),
    initial.revision,
  );
  await db.save(null, new Map(), revision);
  await expect(db.save(draft(), new Map(), revision)).rejects.toBeInstanceOf(
    DraftConflict,
  );
  expect((await db.load()).draft).toBeNull();
});
it('removes incompatible/corrupt drafts rather than crashing recovery', async () => {
  const db = setup();
  await db.save(
    { ...draft(), version: 99 } as unknown as ScanDraft,
    new Map(),
    (await db.load()).revision,
  );
  expect((await db.load()).draft).toBeNull();
});
