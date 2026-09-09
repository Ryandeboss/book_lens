import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default(''),
});
export const env = schema.parse(process.env);
export const allowedOrigins = [
  env.FRONTEND_URL,
  ...env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
];
