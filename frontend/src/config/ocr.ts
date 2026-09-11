export const ocrConfig = {
  concurrency: 1, // Increase to 2 only after mobile bandwidth/Render profiling.
  cloudTimeoutMs: 65000,
  cloudCooldownMs: 60000, // Avoid uploading every queued page to an unavailable API.
  maxUploadBytes: 12 * 1024 * 1024,
} as const;
