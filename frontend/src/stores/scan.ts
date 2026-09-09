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
    });
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
    updatePage,
    removePage,
    clearSession,
  };
});
