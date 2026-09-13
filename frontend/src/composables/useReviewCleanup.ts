import { computed, onUnmounted, ref } from 'vue';
import { useScanStore } from '../stores/scan';
import { cleanupFailure, proofreadPage } from '../services/api';
export function useReviewCleanup() {
  const session = useScanStore();
  const busy = ref(false);
  const activeId = ref<string | null>(null);
  const remaining = computed(() =>
    session.includedPages.filter(
      (p) =>
        p.status === 'ready' &&
        p.rawText.trim() &&
        p.rawText.length <= 20000 &&
        p.cleanupStatus !== 'applied' &&
        p.cleanupStatus !== 'processing',
    ),
  );
  let controller: AbortController | null = null;
  let disposed = false;
  async function clean(ids: string[]) {
    if (busy.value || disposed) return;
    busy.value = true;
    try {
      for (const id of ids) {
        if (disposed) break;
        const page = session.pages.find((p) => p.id === id);
        if (
          !page ||
          page.status !== 'ready' ||
          !page.rawText.trim() ||
          page.rawText.length > 20000
        )
          continue;
        const raw = page.rawText,
          edited = page.editedText;
        const mayReplace = edited === raw || edited === page.correctedText;
        page.cleanupStatus = 'processing';
        page.cleanupError = undefined;
        activeId.value = id;
        const request = new AbortController();
        controller = request;
        const timer = setTimeout(() => request.abort(), 65000);
        try {
          const result = await proofreadPage(raw, id, request.signal);
          if (disposed) break;
          session.applyCleanup(
            id,
            raw,
            edited,
            {
              cleanupStatus: result.status,
              correctedText:
                result.status === 'applied' ? result.correctedText : undefined,
              cleanupError:
                result.status === 'unavailable'
                  ? 'The backend has no OpenAI key configured.'
                  : undefined,
            },
            mayReplace,
          );
          if (result.status === 'unavailable') break;
        } catch (error) {
          if (!disposed)
            session.applyCleanup(
              id,
              raw,
              edited,
              { cleanupStatus: 'failed', cleanupError: cleanupFailure(error) },
              false,
            );
          break; // Stop bulk attempts on unavailable service; explicit retry remains available.
        } finally {
          clearTimeout(timer);
          if (page.cleanupStatus === 'processing') {
            page.cleanupStatus = 'failed';
            page.cleanupError =
              'Cleanup cancelled. Original OCR is kept; retry when ready.';
          }
          controller = null;
        }
      }
    } finally {
      busy.value = false;
      activeId.value = null;
    }
  }
  onUnmounted(() => {
    disposed = true;
    controller?.abort();
  });
  return {
    busy,
    activeId,
    remaining,
    cleanPage: (id: string) => clean([id]),
    cleanRemaining: () => clean(remaining.value.map((p) => p.id)),
  };
}
