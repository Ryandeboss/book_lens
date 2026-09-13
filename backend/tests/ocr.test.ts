import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const google = vi.hoisted(() => ({
  processDocument: vi.fn(),
  processorPath: vi.fn(
    (project, location, processor) =>
      `projects/${project}/locations/${location}/processors/${processor}`,
  ),
}));
vi.mock('@google-cloud/documentai', () => ({
  v1: {
    DocumentProcessorServiceClient: class {
      processDocument = google.processDocument;
      processorPath = google.processorPath;
    },
  },
}));
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
const pageId = '94b7e684-d9cf-4b9e-8c9e-0588bfe19203';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const send = (image = png, mime = 'image/png') =>
  request(app)
    .post('/api/ocr')
    .field('pageId', pageId)
    .attach('image', image, { filename: 'page.png', contentType: mime });
beforeEach(() => {
  env.GOOGLE_CLOUD_PROJECT_ID = 'test-project';
  env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = 'test-processor';
  env.GOOGLE_DOCUMENT_AI_LOCATION = 'us';
  env.OCR_REQUESTS_PER_MINUTE = 1000;
  env.OCR_MAX_CONCURRENT_REQUESTS = 2;
  google.processDocument.mockReset();
  google.processorPath.mockClear();
  google.processDocument.mockResolvedValue([
    {
      document: {
        text: 'Heading\nBody text.\n',
        pages: [
          {
            paragraphs: [
              {
                layout: {
                  textAnchor: { textSegments: [{ endIndex: '8' }] },
                  confidence: 0.98,
                },
              },
              {
                layout: {
                  textAnchor: {
                    textSegments: [{ startIndex: '8', endIndex: '19' }],
                  },
                  confidence: 0.94,
                },
              },
            ],
            detectedLanguages: [{ languageCode: 'en' }],
          },
        ],
      },
    },
  ]);
});
describe('Document AI OCR endpoint', () => {
  it('requests token scores and returns the derived percentage through the real endpoint', async () => {
    // Mimic Google's field-mask behavior, so omitting pages.tokens breaks this test.
    google.processDocument.mockImplementation(async (input) => [
      {
        document: {
          text: 'AB CDEFGH',
          pages: [
            {
              ...(input.fieldMask.paths.includes('pages.tokens')
                ? {
                    tokens: [
                      {
                        layout: {
                          confidence: 0.7,
                          textAnchor: { textSegments: [{ endIndex: '3' }] },
                        },
                      },
                      {
                        layout: {
                          confidence: 0.9,
                          textAnchor: {
                            textSegments: [{ startIndex: '3', endIndex: '9' }],
                          },
                        },
                      },
                    ],
                  }
                : {}),
            },
          ],
        },
      },
    ]);
    const result = await send();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      provider: 'google-document-ai',
      text: 'AB CDEFGH',
      confidence: 85,
      confidenceMethod: 'token-character-weighted',
    });
    expect(result.body).not.toHaveProperty('pages');
    expect(result.body).not.toHaveProperty('tokens');
    expect(google.processDocument).toHaveBeenCalledOnce();
  });
  it('forwards validated bytes with v1, a deadline and no paid retry; returns compact structured text', async () => {
    const result = await send();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      provider: 'google-document-ai',
      text: 'Heading\n\nBody text.',
      paragraphs: [
        { text: 'Heading', confidence: 0.98 },
        { text: 'Body text.', confidence: 0.94 },
      ],
      detectedLanguages: ['en'],
    });
    expect(result.body.confidence).toBeUndefined();
    expect(result.headers['cache-control']).toBe('no-store');
    expect(google.processorPath).toHaveBeenCalledWith(
      'test-project',
      'us',
      'test-processor',
    );
    expect(google.processDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'projects/test-project/locations/us/processors/test-processor',
        rawDocument: { content: png, mimeType: 'image/png' },
      }),
      { timeout: 45000, retry: null },
    );
  });
  it('accepts JPEG bytes', async () => {
    expect(
      (await send(Buffer.from([255, 216, 255, 224]), 'image/jpeg')).status,
    ).toBe(200);
  });
  it('rejects missing images', async () => {
    expect(
      (await request(app).post('/api/ocr').field('pageId', pageId)).status,
    ).toBe(400);
    expect(google.processDocument).not.toHaveBeenCalled();
  });
  it('rejects missing/invalid UUIDs and unknown fields', async () => {
    for (const id of ['', 'invalid'])
      expect(
        (
          await request(app)
            .post('/api/ocr')
            .field('pageId', id)
            .attach('image', png, 'page.png')
        ).status,
      ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/ocr')
          .field('pageId', pageId)
          .field('extra', 'x')
          .attach('image', png, 'page.png')
      ).status,
    ).toBe(400);
  });
  it.each(['image/webp', 'text/plain', 'application/pdf'])(
    'rejects unsupported MIME %s',
    async (mime) => {
      expect((await send(png, mime)).status).toBe(415);
      expect(google.processDocument).not.toHaveBeenCalled();
    },
  );
  it('rejects spoofed MIME types and oversized images', async () => {
    expect((await send(Buffer.from('not a png'))).status).toBe(415);
    expect((await send(Buffer.alloc(12 * 1024 * 1024 + 1))).status).toBe(413);
    expect(google.processDocument).not.toHaveBeenCalled();
  });
  it('starts without configuration and exposes only a capability boolean', async () => {
    env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = '';
    expect((await request(app).get('/api/ocr/status')).body).toEqual({
      googleDocumentAiConfigured: false,
    });
    expect((await send()).status).toBe(503);
    expect(google.processDocument).not.toHaveBeenCalled();
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
  it.each([
    [14, 503],
    [7, 503],
    [4, 504],
  ])('sanitizes upstream failure %s', async (code, status) => {
    google.processDocument.mockRejectedValue(
      Object.assign(new Error('PRIVATE KEY secret OCR text'), { code }),
    );
    const result = await send();
    expect(result.status).toBe(status);
    expect(JSON.stringify(result.body)).not.toMatch(
      /PRIVATE|secret|test-processor/,
    );
    expect(google.processDocument).toHaveBeenCalledOnce();
  });
  it('rejects a response without a document', async () => {
    google.processDocument.mockResolvedValue([{}]);
    expect((await send()).status).toBe(502);
  });
  it('bounds active requests while another page is processing', async () => {
    env.OCR_MAX_CONCURRENT_REQUESTS = 1;
    let complete!: (value: unknown) => void;
    google.processDocument.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const first = send().then((r) => r);
    await vi.waitFor(() =>
      expect(google.processDocument).toHaveBeenCalledOnce(),
    );
    expect((await send()).status).toBe(429);
    complete([{ document: { text: 'first' } }]);
    expect((await first).status).toBe(200);
  });
});

it('deadlines include a stalled SDK/auth initialization and keep its active slot bounded', async () => {
  const { recognizeDocument } =
    await import('../src/services/documentOcr.service.js');
  env.OCR_MAX_CONCURRENT_REQUESTS = 1;
  let finish!: (value: unknown) => void;
  google.processDocument.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.useFakeTimers();
  try {
    const pending = recognizeDocument(png, 'image/png');
    const rejected = expect(pending).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(env.OCR_TIMEOUT_MS);
    await rejected;
    await expect(recognizeDocument(png, 'image/png')).rejects.toMatchObject({
      status: 429,
    });
    finish([{ document: { text: 'late' } }]);
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    vi.useRealTimers();
  }
});
