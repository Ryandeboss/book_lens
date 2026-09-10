import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { ScannedPage } from '../types/Page';

export const useScanStore = defineStore('scan', () => {
  const pages = ref<ScannedPage[]>([]);
  const currentPageNumber = computed(() => pages.value.length + 1);
  const combinedText = computed(() =>
    pages.value.map((page) => page.editedText).join('\n\n\n'),
  );

  function addPage(
    page: Pick<ScannedPage, 'rawText' | 'editedText' | 'confidence'>,
  ) {
    pages.value.push({
      ...page,
      id: crypto.randomUUID(),
      pageNumber: currentPageNumber.value,
      status: 'ready',
    });
  }
  function reservePage(fingerprint: number[]) {
    const page: ScannedPage = {
      id: crypto.randomUUID(),
      pageNumber: currentPageNumber.value,
      status: 'queued',
      rawText: '',
      editedText: '',
      fingerprint,
    };
    pages.value.push(page);
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
  function completePage(
    id: string,
    result: { rawText: string; confidence?: number },
  ) {
    const page = pages.value.find((page) => page.id === id);
    if (page) {
      page.rawText = result.rawText;
      page.editedText = result.rawText;
      page.confidence = result.confidence;
      page.status = 'ready';
      page.error = undefined;
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
  }
  function clearSession() {
    pages.value = [];
  }
  return {
    pages,
    currentPageNumber,
    combinedText,
    addPage,
    reservePage,
    setQueued,
    setProcessing,
    completePage,
    failPage,
    updatePage,
    removePage,
    clearSession,
  };
});
