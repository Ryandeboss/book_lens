import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import OcrComparison from './OcrComparison.vue';
const mocks = vi.hoisted(() => ({
  cloud: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(async () => {}),
}));
vi.mock('../../services/api', () => ({ ocrPage: mocks.cloud }));
vi.mock('../../composables/useOcr', () => ({
  useOcr: () => ({ recognize: mocks.recognize, terminate: mocks.terminate }),
}));
it('compares the same selected image only on explicit click and releases it afterwards', async () => {
  mocks.cloud.mockResolvedValue({ text: 'Google transcription' });
  mocks.recognize.mockResolvedValue({ rawText: 'Tesseract transcription' });
  const wrapper = mount(OcrComparison);
  const file = new File(['page'], 'page.jpg', { type: 'image/jpeg' });
  Object.defineProperty(wrapper.get('input').element, 'files', {
    value: [file],
  });
  await wrapper.get('input').trigger('change');
  expect(mocks.cloud).not.toHaveBeenCalled();
  await wrapper.get('button').trigger('click');
  await flushPromises();
  expect(mocks.cloud).toHaveBeenCalledWith(
    file,
    expect.any(String),
    expect.any(AbortSignal),
  );
  expect(mocks.recognize).toHaveBeenCalledWith(file);
  expect(wrapper.text()).toContain('Google transcription');
  expect(wrapper.text()).toContain('Tesseract transcription');
  expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  expect(mocks.terminate).toHaveBeenCalledOnce();
  wrapper.unmount();
});
