// Browser Origin headers never include a trailing slash or URL path.
// Normalize configured URLs while retaining an explicit origin allowlist.
export function normalizeOrigins(values: string[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        try {
          const url = new URL(value.trim());
          return ['http:', 'https:'].includes(url.protocol) ? [url.origin] : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
