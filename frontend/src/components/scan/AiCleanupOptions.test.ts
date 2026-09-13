import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, expect, it, vi } from 'vitest';
import AiCleanupOptions from './AiCleanupOptions.vue';
import { getProofreadStatus } from '../../services/api';
import { useScanStore } from '../../stores/scan';
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  getProofreadStatus: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
it('shows detected server configuration, allows toggling and refreshes status without a paid request', async () => {
  vi.mocked(getProofreadStatus)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  const pinia = createPinia();
  const wrapper = mount(AiCleanupOptions, { global: { plugins: [pinia] } });
  await flushPromises();
  expect(wrapper.text()).toContain('OpenAI key detected');
  expect(wrapper.get('[role="status"]').text()).toContain(
    'Connected to cleanup backend',
  );
  expect(wrapper.get('button').text()).toBe('Check again');
  await wrapper.get('input').setValue(false);
  expect(useScanStore(pinia).cleanupEnabled).toBe(false);
  await wrapper.get('button').trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('no OpenAI key');
  wrapper.unmount();
});
it('distinguishes an unreachable backend from a missing key', async () => {
  vi.mocked(getProofreadStatus).mockRejectedValue(new Error('offline'));
  const wrapper = mount(AiCleanupOptions, {
    global: { plugins: [createPinia()] },
  });
  await flushPromises();
  expect(wrapper.text()).toContain('Cannot reach AI cleanup');
  expect(wrapper.get('[role="status"]').text()).toContain(
    'Cleanup connection check failed',
  );
  expect(wrapper.get('details').text()).toContain('FRONTEND_URL');
  expect(wrapper.text()).not.toContain('reports no OpenAI key');
  wrapper.unmount();
});
