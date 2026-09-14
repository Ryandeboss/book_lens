import { scannerConfig } from '../config/scanner';
import type { PageFingerprint } from '../types/scanner';
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { duplicateTextScore } from '../services/textDuplicates';
import type { ScannedPage, OcrResult } from '../types/Page';

export const useScanStore = defineStore('scan', () => {
  const pages = ref<ScannedPage[]>([]);
  const cleanupEnabled = ref(true);
  const captureMode = ref<'fast' | 'verified'>('fast');
  let captureSequence = 0;
  const includedPages = computed(() =>
    pages.value.filter((p) => !p.duplicateOf || p.keepDuplicate),
  );
  const duplicatePages = computed(() =>
    pages.value.filter((p) => p.duplicateOf && !p.keepDuplicate),
  );
  const currentPageNumber = computed(() => pages.value.length + 1);
  const combinedText = computed(() =>
    includedPages.value.map((page) => page.editedText).join('\n\n\n'),
  );

  function addPage(
    page: Pick<ScannedPage, 'rawText' | 'editedText' | 'confidence'>,
  ) {
    pages.value.push({
      ...page,
      id: crypto.randomUUID(),
      pageNumber: currentPageNumber.value,
      capturePosition: ++captureSequence,
      status: 'ready',
    });
    findDuplicates();
  }
  function reservePage(
    fingerprint: number[],
    visualFingerprint?: PageFingerprint,
    id: string = crypto.randomUUID(),
  ) {
    const page: ScannedPage = {
      id,
      pageNumber: currentPageNumber.value,
      capturePosition: ++captureSequence,
      status: 'queued',
      rawText: '',
      editedText: '',
      fingerprint,
      visualFingerprint,
    };
    pages.value.push(page);
    for (const old of pages.value.slice(0, -scannerConfig.recentFingerprints)) {
      old.visualFingerprint = undefined;
      old.fingerprint = undefined;
    }
    return page.id;
  }
  function setQueued(id: string) {
    const page = pages.value.find((page) => page.id === id);
    if (page) {
      page.status = 'queued';
      page.error = undefined;
    }
  }
  function setProcessing(id: string) {
    const page = pages.value.find((page) => page.id === id);
    if (page) {
      page.status = 'processing';
      page.error = undefined;
    }
  }
  function completePage(id: string, result: OcrResult) {
    const page = pages.value.find((page) => page.id === id);
    if (page) {
      page.rawText = result.rawText;
      page.correctedText = result.correctedText;
      page.editedText = result.correctedText ?? result.rawText;
      page.cleanupStatus = result.cleanupStatus;
      page.cleanupError = result.cleanupError;
      page.confidence = result.confidence;
      page.ocrProvider = result.ocrProvider;
      page.paragraphs = result.paragraphs;
      page.detectedLanguages = result.detectedLanguages;
      page.status = 'ready';
      page.error = undefined;
      findDuplicates();
    }
  }
  function recordOcr(id: string, result: OcrResult) {
    const page = pages.value.find((p) => p.id === id);
    if (!page) return;
    page.rawText = result.rawText;
    page.editedText = result.rawText;
    page.confidence = result.confidence;
    page.ocrProvider = result.ocrProvider;
    page.paragraphs = result.paragraphs;
    page.detectedLanguages = result.detectedLanguages;
    findDuplicates();
  }
  function findDuplicates() {
    const originals: ScannedPage[] = [];
    // Array order is capture order, regardless of OCR completion order.
    for (const page of pages.value) {
      page.duplicateOf = undefined;
      page.duplicateScore = undefined;
      if (!page.rawText.trim()) continue;
      for (const original of originals) {
        const score = duplicateTextScore(page.rawText, original.rawText);
        if (score !== null) {
          page.duplicateOf = original.id;
          page.duplicateScore = score;
          break;
        }
      }
      if (!page.duplicateOf) originals.push(page);
    }
  }
  function keepDuplicate(id: string, keep: boolean) {
    const page = pages.value.find((p) => p.id === id);
    if (page) page.keepDuplicate = keep;
  }
  function applyCleanup(
    id: string,
    rawText: string,
    editedBefore: string,
    result: {
      correctedText?: string;
      cleanupStatus: ScannedPage['cleanupStatus'];
      cleanupError?: string;
    },
    mayReplace: boolean,
  ) {
    const page = pages.value.find((p) => p.id === id);
    if (!page || page.rawText !== rawText) return;
    page.cleanupStatus = result.cleanupStatus;
    page.cleanupError = result.cleanupError;
    if (result.correctedText !== undefined) {
      page.correctedText = result.correctedText;
      if (mayReplace && page.editedText === editedBefore)
        page.editedText = result.correctedText;
    }
  }
  function failPage(id: string, message: string) {
    const page = pages.value.find((page) => page.id === id);
    if (page) {
      page.status = 'error';
      page.error = message;
    }
  }
  function updatePage(id: string, editedText: string) {
    const page = pages.value.find((page) => page.id === id);
    if (page) page.editedText = editedText;
  }
  function removePage(id: string) {
    pages.value = pages.value.filter((page) => page.id !== id);
    pages.value.forEach((page, index) => {
      page.pageNumber = index + 1;
    });
    findDuplicates();
  }
  function clearSession() {
    pages.value = [];
    captureSequence = 0;
  }
  return {
    pages,
    cleanupEnabled,
    captureMode,
    includedPages,
    duplicatePages,
    keepDuplicate,
    applyCleanup,
    currentPageNumber,
    combinedText,
    addPage,
    reservePage,
    setQueued,
    setProcessing,
    completePage,
    recordOcr,
    failPage,
    updatePage,
    removePage,
    clearSession,
  };
});
