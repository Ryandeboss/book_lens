import { GoogleAuth } from 'google-auth-library';
import { env } from '../config/env.js';
import { OcrError } from './ocrError.js';

export const speechMaxBytes = 4500;
export const speechConfigured = () => Boolean(env.GOOGLE_CLOUD_PROJECT_ID);
let auth: GoogleAuth | undefined;
let active = 0;

// One short part per request keeps proxy timeouts and memory bounded. The browser
// requests parts sequentially, and no generated audio or input is written to disk.
export async function synthesizeSpeech(text: string, signal?: AbortSignal) {
  if (!speechConfigured())
    throw new OcrError(
      503,
      'SPEECH_CONFIG',
      'Audio export is not configured on the server.',
    );
  if (active >= 2)
    throw new OcrError(
      429,
      'SPEECH_BUSY',
      'Audio export is busy. Try again shortly.',
    );
  if (signal?.aborted)
    throw new OcrError(499, 'SPEECH_CANCELLED', 'Audio export cancelled.');
  active++;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () =>
        reject(
          new OcrError(
            signal?.aborted ? 499 : 504,
            signal?.aborted ? 'SPEECH_CANCELLED' : 'SPEECH_TIMEOUT',
            signal?.aborted
              ? 'Audio export cancelled.'
              : 'Audio export timed out. Try again.',
          ),
        ),
      { once: true },
    );
    timer = setTimeout(abort, env.TTS_TIMEOUT_MS);
  });
  const operation = (async () => {
    try {
      auth ??= new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      controller.signal.throwIfAborted();
      const response = await client.request<{ audioContent?: string }>({
        url: 'https://texttospeech.googleapis.com/v1/text:synthesize',
        method: 'POST',
        data: {
          input: { text },
          voice: {
            languageCode: env.TTS_LANGUAGE_CODE,
            name: env.TTS_VOICE_NAME,
          },
          audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 },
        },
        signal: controller.signal,
        timeout: env.TTS_TIMEOUT_MS,
        retry: false,
      });
      if (!response.data.audioContent) throw new Error('Missing audio');
      const audio = Buffer.from(response.data.audioContent, 'base64');
      if (!audio.length || audio.length > 8 * 1024 * 1024)
        throw new Error('Invalid audio');
      return audio;
    } catch (cause) {
      // Never expose Google's errors: they can include credentials and input text.
      const status =
        cause && typeof cause === 'object' && 'status' in cause
          ? cause.status
          : undefined;
      throw new OcrError(
        status === 429 ? 429 : 503,
        status === 401 || status === 403
          ? 'SPEECH_ACCESS'
          : status === 429
            ? 'SPEECH_BUSY'
            : 'SPEECH_UNAVAILABLE',
        status === 401 || status === 403
          ? 'Google denied audio access. Check the Text-to-Speech API, billing and service account permissions.'
          : status === 429
            ? 'Google speech quota is busy or exhausted. Try again later.'
            : 'Google audio export is unavailable. Check the voice configuration and try again.',
      );
    } finally {
      // A stalled credential lookup retains its slot until it really settles.
      active--;
    }
  })();
  try {
    return await Promise.race([operation, stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
