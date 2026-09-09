import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, expect, it, vi } from 'vitest';
import ReviewView from './ReviewView.vue';
import { useScanStore } from '../stores/scan';
import { downloadText } from '../services/downloadText';

vi.mock('../services/downloadText', () => ({ downloadText: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
it('edits, exports, deletes, confirms clearing, and retains raw OCR', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useScanStore();
  store.addPage({ rawText: 'raw', editedText: 'raw' });
  store.addPage({ rawText: 'second', editedText: 'second' });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/review', component: ReviewView },
      { path: '/scan', component: { template: '<p>Scan</p>' } },
    ],
  });
  await router.push('/review');
  const wrapper = mount(ReviewView, { global: { plugins: [pinia, router] } });
  await wrapper.findAll('textarea')[0]!.setValue('Edited');
  expect(store.pages[0]?.rawText).toBe('raw');
  expect(store.pages[0]?.editedText).toBe('Edited');
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'Download TXT')!
    .trigger('click');
  expect(downloadText).toHaveBeenCalledWith('Edited\n\n\nsecond');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await wrapper.get('[aria-label="Delete Page 1"]').trigger('click');
  expect(store.pages.length).toBe(2);
  confirm.mockReturnValue(true);
  await wrapper.get('[aria-label="Delete Page 1"]').trigger('click');
  expect(store.pages[0]?.pageNumber).toBe(1);
  expect(store.pages[0]?.editedText).toBe('second');
  confirm.mockReturnValue(false);
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'Start New Scan')!
    .trigger('click');
  expect(store.pages.length).toBe(1);
  confirm.mockReturnValue(true);
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'Start New Scan')!
    .trigger('click');
  await flushPromises();
  expect(store.pages).toEqual([]);
  expect(router.currentRoute.value.path).toBe('/scan');
  wrapper.unmount();
});
