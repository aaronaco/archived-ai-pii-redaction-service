import { z } from 'zod';

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // OpenAI-compatible upstream (gateway or provider)
  UPSTREAM_URL: z
    .string()
    .url()
    .default('https://api.openai.com/v1'),
  UPSTREAM_API_KEY: z.string().min(1).optional(),

  MODEL_ID: z.string().default('aaronaco/piiranha-v1-onnx'),
  MODEL_QUANTIZED: booleanFromString.default(true),

  REDIS_URL: z.string().url().optional(),

  SALT: z.string().min(16, 'SALT must be at least 16 characters').default(
    'dev-salt-change-in-production-1234567890'
  ),
  FAIL_STRATEGY: z.enum(['closed', 'open']).default('closed'),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),

  RISK_THRESHOLD: z.coerce.number().default(100),
  RISK_WINDOW_MS: z.coerce.number().default(3600000),

  INFERENCE_TIMEOUT_MS: z.coerce.number().default(500),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('[ERROR] Environment validation failed:');
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
