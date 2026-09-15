import type { ScannedPage } from '../types/Page';

export const draftLifetimeMs = 24 * 60 * 60 * 1000;
export interface ScanDraft {
  version: 1;
  updatedAt: number;
  expiresAt: number;
  pages: ScannedPage[];
  captureSequence: number;
  cleanupEnabled: boolean;
}
interface RecordValue {
  revision: string;
  draft: ScanDraft | null;
}
export class DraftConflict extends Error {}

function validDraft(value: unknown): value is ScanDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as ScanDraft;
  return (
    d.version === 1 &&
    Number.isFinite(d.updatedAt) &&
    Number.isFinite(d.expiresAt) &&
    d.expiresAt > d.updatedAt &&
    d.expiresAt <= d.updatedAt + draftLifetimeMs &&
    Number.isSafeInteger(d.captureSequence) &&
    d.captureSequence >= 0 &&
    typeof d.cleanupEnabled === 'boolean' &&
    Array.isArray(d.pages) &&
    new Set(d.pages.map((p) => p?.id)).size === d.pages.length &&
    d.pages.every(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.rawText === 'string' &&
        typeof p.editedText === 'string' &&
        Number.isSafeInteger(p.pageNumber) &&
        ['ready', 'queued', 'processing', 'error'].includes(p.status),
    )
  );
}

// Metadata and needed Blobs are committed atomically. Images already on disk
// are not rewritten on each text edit. No image is retained for a completed OCR.
export function createScanDraftDb(
  factory: IDBFactory = indexedDB,
  name = 'booklens-drafts',
) {
  let opening: Promise<IDBDatabase> | undefined;
  function open() {
    return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('draft');
        request.result.createObjectStore('images');
      };
      request.onerror = () => {
        opening = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        opening = undefined;
        reject(new Error('Draft database upgrade blocked'));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    }));
  }
  async function load(now = Date.now()): Promise<RecordValue> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['draft', 'images'], 'readwrite');
      const meta = tx.objectStore('draft');
      let value: RecordValue = { revision: '', draft: null };
      const request = meta.get('active');
      request.onsuccess = () => {
        const stored = request.result as RecordValue | undefined;
        if (
          stored?.draft &&
          validDraft(stored.draft) &&
          stored.draft.expiresAt > now
        )
          value = stored;
        else {
          value = {
            revision: stored?.draft
              ? crypto.randomUUID()
              : (stored?.revision ?? ''),
            draft: null,
          };
          meta.put(value, 'active');
          tx.objectStore('images').clear();
        }
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(tx.error ?? new Error('Draft could not be read'));
    });
  }
  async function images(revision: string): Promise<Map<string, Blob>> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['draft', 'images'], 'readonly');
      const result = new Map<string, Blob>();
      let conflict = false;
      const meta = tx.objectStore('draft').get('active');
      meta.onsuccess = () => {
        const stored = meta.result as RecordValue | undefined;
        if (
          stored?.revision !== revision ||
          !stored.draft ||
          stored.draft.expiresAt <= Date.now()
        ) {
          conflict = true;
          tx.abort();
          return;
        }
        const cursor = tx.objectStore('images').openCursor();
        cursor.onsuccess = () => {
          if (cursor.result) {
            result.set(String(cursor.result.key), cursor.result.value as Blob);
            cursor.result.continue();
          }
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          conflict ? new DraftConflict('Draft changed or expired') : tx.error,
        );
    });
  }
  async function save(
    draft: ScanDraft | null,
    blobs: Map<string, Blob>,
    revision: string,
  ): Promise<string> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['draft', 'images'], 'readwrite');
      const meta = tx.objectStore('draft'),
        imageStore = tx.objectStore('images');
      const next = crypto.randomUUID();
      let conflict = false;
      const request = meta.get('active');
      request.onsuccess = () => {
        if (
          ((request.result as RecordValue | undefined)?.revision ?? '') !==
          revision
        ) {
          conflict = true;
          tx.abort();
          return;
        }
        // Keep a revision tombstone on deletion so another tab cannot revive it.
        meta.put({ revision: next, draft }, 'active');
        if (!draft) {
          imageStore.clear();
          return;
        }
        const keys = imageStore.getAllKeys();
        keys.onsuccess = () => {
          const existing = new Set(keys.result.map(String));
          for (const id of existing) if (!blobs.has(id)) imageStore.delete(id);
          for (const [id, blob] of blobs)
            if (!existing.has(id)) imageStore.put(blob, id);
        };
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () =>
        reject(
          conflict
            ? new DraftConflict('Draft changed in another tab')
            : (tx.error ?? new Error('Draft save failed')),
        );
    });
  }
  async function close() {
    (await opening)?.close();
    opening = undefined;
  }
  return { load, images, save, close };
}
export type ScanDraftDb = ReturnType<typeof createScanDraftDb>;
