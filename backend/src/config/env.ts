import 'dotenv/config';
import { z } from 'zod';
import { normalizeOrigins } from './origins.js';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default(''),
  GOOGLE_CLOUD_PROJECT_ID: z.string().trim().default(''),
  GOOGLE_DOCUMENT_AI_LOCATION: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]*$/)
    .default('us'),
  GOOGLE_DOCUMENT_AI_PROCESSOR_ID: z.string().trim().default(''),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default(''),
  OCR_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(4).default(2),
  OCR_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(30),
  OCR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(45000),
  OPENAI_API_KEY: z.string().trim().default(''),
  OPENAI_PROOFREAD_MODEL: z.string().trim().min(1).default('gpt-5.4-nano'),
  PROOFREAD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(45000),
  PROOFREAD_REQUESTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(30),
});
export const env = schema.parse(process.env);
export const allowedOrigins = normalizeOrigins([
  env.FRONTEND_URL,
  ...env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);
