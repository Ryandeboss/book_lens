import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('API foundation', () => {
  it('returns health JSON', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'booklens-api' });
  });
  it('allows the configured frontend origin', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
  });
  it('does not grant CORS to unknown origins', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://untrusted.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('handles malformed JSON centrally', async () => {
    const response = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid request' });
  });
  it('returns JSON for missing routes', async () => {
    expect((await request(app).get('/api/missing')).status).toBe(404);
  });
});
