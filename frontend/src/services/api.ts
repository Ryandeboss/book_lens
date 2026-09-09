import type { HealthResponse } from '../types/api';

const apiUrl = (
  import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
).replace(/\/$/, '');

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiUrl}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== 'object' ||
    !('status' in data) ||
    data.status !== 'ok' ||
    !('service' in data) ||
    data.service !== 'booklens-api'
  ) {
    throw new Error('Unexpected health response');
  }
  return { status: data.status, service: data.service };
}
