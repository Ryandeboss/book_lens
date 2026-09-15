import { afterEach, expect, it, vi } from 'vitest';
import {
  createAudio,
  joinMp3,
  requestSpeech,
  splitSpeechText,
} from './speechExport';
afterEach(() => vi.unstubAllGlobals());
// MPEG-2 layer III, 32 kbps, 24 kHz mono: 96-byte frames of silence.
function frame() {
  const result = new Uint8Array(96);
  result.set([255, 243, 68, 192]);
  return result;
}
const part = () => new Uint8Array([...frame(), ...frame()]);
it('splits Unicode into bounded parts without losing or reordering words', () => {
  const text =
    'Hello café 世界 🌱. Another sentence.\n\nNext paragraph. '.repeat(200);
  const chunks = splitSpeechText(text, 100);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((c) => new TextEncoder().encode(c).length <= 100)).toBe(
    true,
  );
  expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(
    text.replace(/\s+/g, ' ').trim(),
  );
  expect(chunks.join('')).not.toContain('\ufffd');
  expect(
    splitSpeechText('界'.repeat(2000)).every(
      (c) => new TextEncoder().encode(c).length <= 4500,
    ),
  ).toBe(true);
});
it('rejects empty and excessive documents before a paid request', () => {
  expect(() => splitSpeechText('  ')).toThrow('no text');
  expect(() => splitSpeechText('界'.repeat(40000))).toThrow('100,000');
});
it('joins complete frames and removes per-part duration and ID3 tags', async () => {
  const info = frame();
  info.set(new TextEncoder().encode('Info'), 13);
  const id3 = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]);
  const blob = joinMp3([new Uint8Array([...id3, ...info, ...part()]), part()]);
  expect(blob.type).toBe('audio/mpeg');
  expect(blob.size).toBe(4 * 96);
});
it('rejects truncated or incompatible audio instead of downloading a corrupt MP3', () => {
  expect(() => joinMp3([part().subarray(0, 100)])).toThrow('Truncated');
  const other = new Uint8Array(144);
  other.set([255, 243, 100, 192]);
  expect(() => joinMp3([part(), other])).toThrow('incompatible');
  expect(() => joinMp3([new Uint8Array([1, 2, 3])])).toThrow();
});
it('generates sequentially, reports progress and returns a complete MP3', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(part(), { headers: { 'Content-Type': 'audio/mpeg' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const text = 'A complete sentence. '.repeat(400),
    progress = vi.fn();
  const chunks = splitSpeechText(text);
  const result = await createAudio(
    text,
    new AbortController().signal,
    progress,
  );
  expect(fetchMock).toHaveBeenCalledTimes(chunks.length);
  expect(
    fetchMock.mock.calls.map(
      (c) =>
        JSON.parse((c as unknown as [string, RequestInit])[1].body as string)
          .text,
    ),
  ).toEqual(chunks);
  expect(progress).toHaveBeenLastCalledWith(chunks.length, chunks.length);
  expect(result.size).toBe(chunks.length * 192);
});
it('cancels without starting later parts or retrying a paid call', async () => {
  const abort = new AbortController();
  const fetchMock = vi.fn(async () => {
    abort.abort();
    return new Response(part(), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    createAudio('Some words. '.repeat(1000), abort.signal, vi.fn()),
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('surfaces safe quota/access errors and rejects HTML responses', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ code: 'SPEECH_ACCESS' }), { status: 503 }),
    );
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    requestSpeech('Hello', new AbortController().signal),
  ).rejects.toThrow('Google denied');
  fetchMock.mockResolvedValue(
    new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }),
  );
  await expect(
    requestSpeech('Hello', new AbortController().signal),
  ).rejects.toThrow('MP3');
});
