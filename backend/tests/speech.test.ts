import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const mock = vi.hoisted(() => ({ request: vi.fn(), getClient: vi.fn() }));
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getClient = mock.getClient;
  },
}));
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { synthesizeSpeech } from '../src/services/speech.service.js';
const project = env.GOOGLE_CLOUD_PROJECT_ID;
beforeEach(() => {
  env.GOOGLE_CLOUD_PROJECT_ID = 'test-project';
  mock.request.mockReset();
  mock.getClient.mockReset();
  mock.getClient.mockResolvedValue({ request: mock.request });
  mock.request.mockResolvedValue({
    data: { audioContent: Buffer.from('mock-mp3').toString('base64') },
  });
});
afterEach(() => {
  env.GOOGLE_CLOUD_PROJECT_ID = project;
  vi.useRealTimers();
});
it('uses ADC, plain text, configured voice and MP3; returns only audio without caching', async () => {
  const res = await request(app)
    .post('/api/speech')
    .send({ text: 'A reviewed page.' });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('audio/mpeg');
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body.toString()).toBe('mock-mp3');
  expect(mock.request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://texttospeech.googleapis.com/v1/text:synthesize',
      retry: false,
      data: {
        input: { text: 'A reviewed page.' },
        voice: { languageCode: 'en-US', name: 'en-US-Standard-C' },
        audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 },
      },
    }),
  );
});
it('reports unconfigured status without calling Google', async () => {
  env.GOOGLE_CLOUD_PROJECT_ID = '';
  expect((await request(app).get('/api/speech/status')).body).toMatchObject({
    configured: false,
    maxBytes: 4500,
  });
  const res = await request(app).post('/api/speech').send({ text: 'A page' });
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('SPEECH_CONFIG');
  expect(mock.request).not.toHaveBeenCalled();
});
it.each([
  {},
  { text: '' },
  { text: '  ' },
  { text: 'a'.repeat(4501) },
  { text: '界'.repeat(1501) },
  { text: 'Page', voice: 'arbitrary' },
])('validates text in UTF-8 bytes: %j', async (body) => {
  expect((await request(app).post('/api/speech').send(body)).status).toBe(400);
  expect(mock.request).not.toHaveBeenCalled();
});
it.each([
  [403, 'SPEECH_ACCESS'],
  [429, 'SPEECH_BUSY'],
  [500, 'SPEECH_UNAVAILABLE'],
])('sanitizes upstream error %s', async (status, code) => {
  mock.request.mockRejectedValue({
    status,
    message: 'PRIVATE_KEY private page text',
  });
  const res = await request(app)
    .post('/api/speech')
    .send({ text: 'private page text' });
  expect(res.body.code).toBe(code);
  expect(res.text).not.toMatch(/PRIVATE_KEY|private page text/);
});
it('rejects empty upstream audio', async () => {
  mock.request.mockResolvedValue({ data: {} });
  await expect(synthesizeSpeech('A page')).rejects.toMatchObject({
    code: 'SPEECH_UNAVAILABLE',
  });
});
it('bounds concurrency during credential lookup, then releases slots', async () => {
  const resolve: ((value: { request: typeof mock.request }) => void)[] = [];
  mock.getClient.mockImplementation(() => new Promise((r) => resolve.push(r)));
  const first = synthesizeSpeech('one'),
    second = synthesizeSpeech('two');
  await expect(synthesizeSpeech('three')).rejects.toMatchObject({
    code: 'SPEECH_BUSY',
  });
  resolve.forEach((r) => r({ request: mock.request }));
  await Promise.all([first, second]);
});
it('aborts requests without retrying and recovers after timeout', async () => {
  vi.useFakeTimers();
  mock.request.mockImplementation(
    ({ signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  const pending = expect(synthesizeSpeech('A page')).rejects.toMatchObject({
    code: 'SPEECH_TIMEOUT',
  });
  await vi.advanceTimersByTimeAsync(env.TTS_TIMEOUT_MS);
  await pending;
  expect(mock.request).toHaveBeenCalledTimes(1);
  const abort = new AbortController();
  abort.abort();
  await expect(synthesizeSpeech('Page', abort.signal)).rejects.toMatchObject({
    code: 'SPEECH_CANCELLED',
  });
});
it('rejects malformed JSON without exposing the input', async () => {
  const res = await request(app)
    .post('/api/speech')
    .set('Content-Type', 'application/json')
    .send('{PRIVATE_KEY');
  expect(res.status).toBe(400);
  expect(res.text).not.toContain('PRIVATE_KEY');
});
