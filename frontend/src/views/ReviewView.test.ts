import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, expect, it, vi } from 'vitest';
import ReviewView from './ReviewView.vue';
import { useScanStore } from '../stores/scan';
import { downloadText } from '../services/downloadText';
import { ocrQueueKey } from '../composables/useOcrQueue';
import { createOcrQueue } from '../services/ocrQueue';

vi.mock('../services/downloadText', () => ({ downloadText: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
it('restores a duplicate at its original position and can undo AI cleanup before TXT export', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useScanStore();
  const raw =
    'A long printed page with enough words to compare safely. '.repeat(10);
  const first = store.reservePage([]),
    second = store.reservePage([]);
  store.completePage(first, {
    rawText: raw,
    correctedText: 'Cleaned first page',
    cleanupStatus: 'applied',
  });
  store.completePage(second, {
    rawText: raw,
    correctedText: 'Cleaned duplicate',
    cleanupStatus: 'applied',
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/review', component: ReviewView }],
  });
  await router.push('/review');
  const queue = createOcrQueue(store, {
    recognize: vi.fn(),
    terminate: vi.fn(async () => {}),
  });
  const wrapper = mount(ReviewView, {
    global: {
      plugins: [pinia, router],
      provide: { [ocrQueueKey as symbol]: queue },
    },
  });
  expect(wrapper.findAll('textarea')).toHaveLength(1);
  expect(wrapper.text()).toContain('Matches original shot 1');
  const click = async (text: string) =>
    wrapper
      .findAll('button')
      .find((b) => b.text() === text)!
      .trigger('click');
  await click('Download TXT');
  expect(downloadText).toHaveBeenLastCalledWith('Cleaned first page');
  await click('Keep this page in TXT');
  expect(wrapper.findAll('textarea')).toHaveLength(2);
  await click('Use original OCR');
  expect(store.pages[0]?.rawText).toBe(raw);
  expect(store.pages[0]?.correctedText).toBe('Cleaned first page');
  await click('Download TXT');
  expect(downloadText).toHaveBeenLastCalledWith(
    raw + '\n\n\nCleaned duplicate',
  );
  await click('Set duplicate aside again');
  expect(wrapper.findAll('textarea')).toHaveLength(1);
  wrapper.unmount();
  await queue.dispose();
});
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
  const queue = createOcrQueue(store, {
    recognize: vi.fn(),
    terminate: vi.fn(async () => {}),
  });
  const wrapper = mount(ReviewView, {
    global: {
      plugins: [pinia, router],
      provide: { [ocrQueueKey as symbol]: queue },
    },
  });
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

it('marks OCR failures, retries in place, and leaves other pages editable', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useScanStore();
  const engine = {
    recognize: vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ rawText: 'Recovered' }),
    terminate: vi.fn(async () => {}),
  };
  const queue = createOcrQueue(store, engine);
  queue.enqueue(new Blob(['failed']), []);
  await queue.waitUntilIdle();
  store.addPage({ rawText: 'Good page', editedText: 'Good page' });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/review', component: ReviewView },
      { path: '/scan', component: { template: '<p>Scan</p>' } },
    ],
  });
  await router.push('/review');
  const wrapper = mount(ReviewView, {
    global: {
      plugins: [pinia, router],
      provide: { [ocrQueueKey as symbol]: queue },
    },
  });
  expect(wrapper.text()).toContain('OCR failed');
  expect(wrapper.findAll('textarea')).toHaveLength(1);
  const id = store.pages[0]!.id;
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'Retry')!
    .trigger('click');
  await flushPromises();
  expect(store.pages[0]).toMatchObject({
    id,
    pageNumber: 1,
    status: 'ready',
    rawText: 'Recovered',
  });
  expect(wrapper.findAll('textarea')).toHaveLength(2);
  expect(store.pages[1]?.editedText).toBe('Good page');
  wrapper.unmount();
  await queue.dispose();
});
