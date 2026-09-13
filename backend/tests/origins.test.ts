import { expect, it } from 'vitest';
import cors from 'cors';
import express from 'express';
import request from 'supertest';
import { normalizeOrigins } from '../src/config/origins.js';

it('matches browser origins when configured URLs contain slashes, paths or whitespace', async () => {
  const origins = normalizeOrigins([
    ' https://scanner.example/ ',
    'https://scanner.example/scan',
    'http://localhost:5173/',
  ]);
  expect(origins).toEqual(['https://scanner.example', 'http://localhost:5173']);
  const app = express().use(cors({ origin: origins }));
  const response = await request(app)
    .options('/api/proofread')
    .set('Origin', 'https://scanner.example')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type');
  expect(response.status).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBe(
    'https://scanner.example',
  );
  expect(response.headers['access-control-allow-headers']).toBe('content-type');
  const blocked = await request(app)
    .options('/api/proofread')
    .set('Origin', 'https://other.example');
  expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
});

it('does not turn invalid origins into wildcard or null access', () => {
  expect(
    normalizeOrigins(['', '*', 'null', 'file:///tmp/page', 'invalid']),
  ).toEqual([]);
});
