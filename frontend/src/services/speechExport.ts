import { apiUrl } from './api';

export const maxAudioTextBytes = 100000;
const encoder = new TextEncoder();
// Split on paragraph/sentence/word boundaries where possible, never splitting a
// Unicode code point. Google's synchronous limit is bytes, not JS string length.
export function splitSpeechText(text: string, maxBytes = 4500): string[] {
  if (maxBytes < 4) throw new Error('Audio part limit is too small.');
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('There is no text to read yet.');
  if (encoder.encode(normalized).length > maxAudioTextBytes)
    throw new Error(
      'MP3 export supports up to 100,000 UTF-8 bytes at a time. Export a shorter scan.',
    );
  const parts: string[] = [];
  let remaining = normalized;
  while (remaining) {
    let bytes = 0,
      end = 0,
      boundary = 0;
    for (const char of remaining) {
      const size = encoder.encode(char).length;
      if (bytes + size > maxBytes) break;
      bytes += size;
      end += char.length;
      if (/\s/u.test(char)) boundary = end;
    }
    if (end < remaining.length && boundary > 0) end = boundary;
    const candidate = remaining.slice(0, end);
    // Prefer a natural pause near the end, without producing tiny parts.
    const pauses = [...candidate.matchAll(/\n\s*\n|[.!?。！？](?:\s|$)/gu)];
    const last = pauses.at(-1);
    if (end < remaining.length && last && last.index > candidate.length / 2)
      end = last.index + last[0].length;
    const part = remaining.slice(0, end).trim();
    if (part) parts.push(part);
    remaining = remaining.slice(end).trimStart();
  }
  return parts;
}

const messages: Record<string, string> = {
  SPEECH_CONFIG: 'Audio export is not configured on Render yet.',
  SPEECH_ACCESS:
    'Google denied speech access. Check the enabled API, billing and service account permissions in Google Cloud.',
  SPEECH_BUSY:
    'Audio export is busy or Google speech quota is exhausted. Try again later.',
  SPEECH_TIMEOUT: 'Google audio took too long. Try again shortly.',
};
export async function requestSpeech(
  text: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 65000);
  try {
    const response = await fetch(`${apiUrl}/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        code?: string;
      } | null;
      throw new Error(
        messages[data?.code ?? ''] ??
          (response.status === 404
            ? 'Audio endpoint not found. Deploy the latest Render backend.'
            : 'Audio export failed. Check the speech configuration and try again.'),
      );
    }
    if (!response.headers.get('Content-Type')?.includes('audio/mpeg'))
      throw new Error('The server did not return MP3 audio.');
    const audio = new Uint8Array(await response.arrayBuffer());
    if (!audio.length || audio.length > 8 * 1024 * 1024)
      throw new Error('Invalid audio response.');
    return audio;
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted)
      throw new Error('Audio export timed out. Try again; your scan is kept.', {
        cause: error,
      });
    if (error instanceof TypeError)
      throw new Error(
        'Could not reach audio export. Check your connection and try again.',
        { cause: error },
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

// Google emits constant-bit-rate MP3. Keep complete audio frames and remove
// per-part ID3/Xing/Info metadata so players see one continuous, seekable CBR file,
// rather than trusting a first-part duration header. No lossy re-encoding.
export function joinMp3(parts: Uint8Array[]): Blob {
  const frames: Uint8Array<ArrayBuffer>[] = [];
  let format = '',
    total = 0;
  for (const part of parts) {
    let offset = 0,
      count = 0,
      audioStart = -1,
      audioEnd = 0;
    if (String.fromCharCode(...part.subarray(0, 3)) === 'ID3') {
      if (part.length < 10 || [...part.subarray(6, 10)].some((n) => n > 127))
        throw new Error('Invalid MP3 metadata.');
      offset =
        10 + ((part[6]! << 21) | (part[7]! << 14) | (part[8]! << 7) | part[9]!);
      if (part[5]! & 0x10) offset += 10;
    }
    while (offset < part.length) {
      if (
        part.length - offset === 128 &&
        String.fromCharCode(...part.subarray(offset, offset + 3)) === 'TAG'
      )
        break;
      const a = part[offset],
        b = part[offset + 1],
        c = part[offset + 2],
        d = part[offset + 3];
      if (
        a !== 255 ||
        b === undefined ||
        c === undefined ||
        d === undefined ||
        (b & 0xe0) !== 0xe0 ||
        ((b >> 1) & 3) !== 1
      )
        throw new Error('Invalid MP3 audio frames.');
      const version = (b >> 3) & 3,
        index = c >> 4,
        rateIndex = (c >> 2) & 3;
      if (version === 1 || index === 0 || index === 15 || rateIndex === 3)
        throw new Error('Unsupported MP3 format.');
      const bitrate = (
        version === 3
          ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
          : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
      )[index]!;
      const sampleRate =
        [44100, 48000, 32000][rateIndex]! /
        (version === 3 ? 1 : version === 2 ? 2 : 4);
      const channels = d >> 6 === 3 ? 1 : 2;
      const length =
        Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / sampleRate) +
        ((c >> 1) & 1);
      if (offset + length > part.length)
        throw new Error('Truncated MP3 audio.');
      const metadataOffset =
        offset +
        4 +
        (b & 1 ? 0 : 2) +
        (version === 3 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17);
      const tag = String.fromCharCode(
        ...part.subarray(metadataOffset, metadataOffset + 4),
      );
      if (count > 0 || (tag !== 'Xing' && tag !== 'Info')) {
        const current = `${version}/${bitrate}/${sampleRate}/${channels}`;
        if (format && format !== current)
          throw new Error(
            'Audio parts use incompatible formats. Please try again.',
          );
        format = current;
        if (audioStart < 0) audioStart = offset;
        audioEnd = offset + length;
        total += length;
        if (total > 64 * 1024 * 1024)
          throw new Error('Audio file exceeds the 64 MB export limit.');
      }
      count++;
      offset += length;
    }
    if (!count) throw new Error('Empty MP3 audio.');
    if (audioStart >= 0) frames.push(part.slice(audioStart, audioEnd));
  }
  if (!frames.length) throw new Error('No audio was generated.');
  return new Blob(frames, { type: 'audio/mpeg' });
}

export async function createAudio(
  text: string,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<Blob> {
  const chunks = splitSpeechText(text),
    parts: Uint8Array[] = [];
  progress(0, chunks.length);
  let totalBytes = 0;
  for (const chunk of chunks) {
    signal.throwIfAborted();
    const part = await requestSpeech(chunk, signal);
    signal.throwIfAborted();
    totalBytes += part.length;
    if (totalBytes > 64 * 1024 * 1024)
      throw new Error('Audio file exceeds the 64 MB export limit.');
    parts.push(part);
    progress(parts.length, chunks.length);
  }
  return joinMp3(parts);
}
