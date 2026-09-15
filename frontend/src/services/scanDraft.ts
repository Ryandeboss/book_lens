import { ref, shallowRef, watch } from 'vue';
import type { useScanStore } from '../stores/scan';
import type { OcrQueue } from './ocrQueue';
import {
  createScanDraftDb,
  DraftConflict,
  draftLifetimeMs,
  type ScanDraft,
  type ScanDraftDb,
} from './scanDraftDb';

export const draftDebounceMs = 400;
export function createScanDraft(
  session: ReturnType<typeof useScanStore>,
  queue: OcrQueue,
  suppliedDb?: ScanDraftDb,
) {
  const ready = ref(false),
    saving = ref(false),
    error = ref('');
  const previous = shallowRef<ScanDraft | null>(null);
  const savedAt = ref<number | null>(null);
  const expired = ref(false);
  let db: ScanDraftDb;
  let revision = '',
    enabled = false,
    disposed = false,
    dirty = false,
    generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let work = Promise.resolve();
  const serial = (action: () => Promise<void>) => {
    work = work.then(action).catch(failed);
    return work;
  };
  function failed(cause: unknown) {
    saving.value = false;
    error.value =
      cause instanceof DraftConflict
        ? 'This draft changed in another tab or expired. Automatic saving is paused here; download your text before closing.'
        : 'Draft saving is unavailable. Your scan is still usable, but download your text before refreshing or closing.';
    if (cause instanceof DraftConflict) enabled = false;
  }
  function cancelTimers() {
    clearTimeout(timer);
    clearTimeout(maxTimer);
    timer = maxTimer = undefined;
  }
  function snapshot(): ScanDraft {
    // Strip Vue proxies and compact visual fingerprints; recovery only needs
    // document state and the existing capture sequence, not duplicate CV data.
    const pages = JSON.parse(
      JSON.stringify(session.pages, (key, value: unknown) =>
        key === 'fingerprint' || key === 'visualFingerprint'
          ? undefined
          : value,
      ),
    ) as ScanDraft['pages'];
    const now = Date.now();
    return {
      version: 1,
      pages,
      captureSequence: session.captureSequence,
      cleanupEnabled: session.cleanupEnabled,
      updatedAt: now,
      expiresAt: now + draftLifetimeMs,
    };
  }
  function armExpiry(expiresAt: number) {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(
      () => {
        if (previous.value) void discard();
        else if (dirty) void flush();
        else {
          expired.value = true;
          void clear(); // Keep live text; remove only the expired recovery copy.
        }
      },
      Math.max(0, expiresAt - Date.now()),
    );
  }
  function schedule() {
    if (!enabled || disposed) return;
    dirty = true;
    expired.value = false;
    savedAt.value = null;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), draftDebounceMs);
    maxTimer ??= setTimeout(() => void flush(), 2000);
  }
  function flush() {
    cancelTimers();
    if (!enabled || disposed || !dirty) return work;
    const current = generation;
    dirty = false;
    return serial(async () => {
      if (current !== generation || !enabled || disposed) return;
      const draft = session.pages.length ? snapshot() : null;
      saving.value = true;
      revision = await db.save(
        draft,
        draft ? queue.draftImages() : new Map(),
        revision,
      );
      if (current !== generation) return;
      saving.value = false;
      error.value = '';
      savedAt.value = dirty ? null : (draft?.updatedAt ?? null);
      if (draft) armExpiry(draft.expiresAt);
    });
  }
  function clear() {
    generation++;
    dirty = false;
    cancelTimers();
    clearTimeout(expiryTimer);
    savedAt.value = null;
    if (!enabled) return work;
    return serial(async () => {
      revision = await db.save(null, new Map(), revision);
      saving.value = false;
      error.value = '';
    });
  }
  async function init() {
    try {
      db = suppliedDb ?? createScanDraftDb();
      const value = await db.load();
      revision = value.revision;
      previous.value = value.draft;
      enabled = !value.draft;
      if (value.draft) armExpiry(value.draft.expiresAt);
    } catch (cause) {
      failed(cause);
    } finally {
      ready.value = true;
    }
  }
  async function resume() {
    const draft = previous.value;
    if (!draft) return false;
    saving.value = true;
    try {
      const images = await db.images(revision);
      clearTimeout(expiryTimer);
      const pages = draft.pages.map((p) => {
        const page = { ...p };
        if (page.ocrCompleted || page.rawText || page.status === 'ready') {
          const interrupted =
            page.status !== 'ready' || page.cleanupStatus === 'processing';
          page.status = 'ready';
          if (interrupted) {
            page.cleanupStatus = 'failed';
            page.cleanupError =
              'Cleanup was interrupted. Your saved text is kept; run AI cleanup again if needed.';
          }
        }
        return page;
      });
      session.restoreSession(
        pages,
        draft.captureSequence,
        draft.cleanupEnabled,
      );
      queue.restoreImages(images);
      previous.value = null;
      enabled = true;
      schedule();
      await flush();
      return true;
    } catch (cause) {
      failed(cause);
      return false;
    } finally {
      saving.value = false;
    }
  }
  async function discard() {
    saving.value = true;
    try {
      revision = await db.save(null, new Map(), revision);
      previous.value = null;
      enabled = true;
      clearTimeout(expiryTimer);
      error.value = '';
    } catch (cause) {
      failed(cause);
    } finally {
      saving.value = false;
    }
  }
  const stopWatch = watch(
    () => [
      session.pages,
      session.captureSequence,
      session.cleanupEnabled,
      queue.imageVersion.value,
      queue.retryVersion.value,
    ],
    schedule,
    { deep: true, flush: 'sync' },
  );
  const stopActions = session.$onAction(({ name, after }) => {
    if (name === 'clearSession')
      after(() => {
        void clear();
      });
  });
  function hidden() {
    if (document.visibilityState === 'hidden') void flush();
  }
  function leaving() {
    void flush();
  }
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', leaving);
  function dispose() {
    disposed = true;
    stopWatch();
    stopActions();
    cancelTimers();
    clearTimeout(expiryTimer);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', leaving);
    void work.then(() => db?.close());
  }
  return {
    ready,
    previous,
    saving,
    error,
    savedAt,
    expired,
    init,
    resume,
    discard,
    flush,
    clear,
    dispose,
  };
}
