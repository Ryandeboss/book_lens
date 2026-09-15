import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DocumentDownloads from './DocumentDownloads.vue';
import { createAudio } from '../../services/speechExport';
import { printPdf } from '../../services/printPdf';
import { createDocx } from '../../services/documentExport';
import { downloadBlob } from '../../services/downloadBlob';
vi.mock('../../services/printPdf', () => ({ printPdf: vi.fn() }));
vi.mock('../../services/speechExport', () => ({ createAudio: vi.fn() }));
vi.mock('../../services/documentExport', () => ({
  createDocx: vi.fn(() => new Blob(['docx'])),
}));
vi.mock('../../services/downloadBlob', () => ({ downloadBlob: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:audio'),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('exports DOCX from reviewed page text in order', async () => {
  const wrapper = mount(DocumentDownloads, {
    props: { pages: ['Edited page one', 'Edited page two'], pending: false },
  });
  await wrapper.get('[aria-controls="text-export-formats"]').trigger('click');
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'DOCX')!
    .trigger('click');
  await vi.waitFor(() =>
    expect(createDocx).toHaveBeenCalledWith([
      'Edited page one',
      'Edited page two',
    ]),
  );
  expect(downloadBlob).toHaveBeenCalledWith(
    expect.any(Blob),
    'booklens-scan.docx',
  );
  wrapper.unmount();
});
it('offers a downloadable MP3 and invalidates it when edited text changes', async () => {
  vi.mocked(createAudio).mockResolvedValue(new Blob(['mp3']));
  const wrapper = mount(DocumentDownloads, {
    props: {
      pages: ['Cleaned first page', 'Edited second page'],
      pending: false,
    },
  });
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'Create audio')!
    .trigger('click');
  await flushPromises();
  expect(createAudio).toHaveBeenCalledWith(
    'Cleaned first page\n\n\nEdited second page',
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(wrapper.get('a[download]').attributes('download')).toBe(
    'booklens-scan.mp3',
  );
  await wrapper.setProps({ pages: ['New text'] });
  expect(wrapper.find('a[download]').exists()).toBe(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio');
  expect(wrapper.text()).toContain('text changed');
  wrapper.unmount();
});
it('cancels work when requested or when leaving Review', async () => {
  vi.mocked(createAudio).mockImplementation(
    (_text, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  const wrapper = mount(DocumentDownloads, {
    props: { pages: ['Page'], pending: false },
  });
  const click = (label: string) =>
    wrapper
      .findAll('button')
      .find((b) => b.text() === label)!
      .trigger('click');
  await click('Create audio');
  const first = vi.mocked(createAudio).mock.calls[0]![1];
  await click('Cancel audio');
  expect(first.aborted).toBe(true);
  await click('Create audio');
  const second = vi.mocked(createAudio).mock.calls[1]![1];
  wrapper.unmount();
  expect(second.aborted).toBe(true);
  await flushPromises();
});
it('requires confirmation for unfinished text and shows an actionable speech failure', async () => {
  vi.mocked(createAudio).mockRejectedValue(
    new Error('Google denied speech access.'),
  );
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const wrapper = mount(DocumentDownloads, {
    props: { pages: ['Page'], pending: true },
  });
  const button = wrapper
    .findAll('button')
    .find((b) => b.text() === 'Create audio')!;
  await button.trigger('click');
  expect(createAudio).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await button.trigger('click');
  await flushPromises();
  expect(wrapper.get('[role=alert]').text()).toContain('Google denied');
  expect(wrapper.find('a[download]').exists()).toBe(false);
  wrapper.unmount();
});

it('opens text format choices and routes PDF to print preview', async () => {
  const wrapper = mount(DocumentDownloads, {
    props: { pages: ['Reviewed page'], pending: false },
  });
  expect(wrapper.find('#text-export-formats').exists()).toBe(false);
  const trigger = wrapper.get('[aria-controls="text-export-formats"]');
  expect(trigger.text()).toBe('Download text');
  await trigger.trigger('click');
  expect(trigger.attributes('aria-expanded')).toBe('true');
  expect(
    wrapper
      .get('#text-export-formats')
      .findAll('button')
      .map((b) => b.text()),
  ).toEqual(['TXT', 'PDF', 'DOCX']);
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'PDF')!
    .trigger('click');
  expect(printPdf).toHaveBeenCalledWith(['Reviewed page']);
  expect(wrapper.find('#text-export-formats').exists()).toBe(false);
  wrapper.unmount();
});
