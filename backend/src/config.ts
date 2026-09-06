import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BACKEND_API_TOKEN: z.string().min(24),
  BACKEND_ACTOR_ID: z.string().trim().min(1).default('lishuo'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  OBJECT_DIR: z.string().min(1).default('.data/objects'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  OPENROUTER_FACT_MODEL: z.string().optional(),
  OPENROUTER_PLAN_MODEL: z.string().optional(),
  OPENROUTER_PROVIDER: z.string().optional(),
  OPENROUTER_MAX_INPUT_TOKENS: z.coerce.number().int().positive().max(1_000_000).optional(),
  OPENROUTER_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(100_000).optional(),
  OPENROUTER_MAX_COST_USD: z.coerce.number().positive().finite().optional(),
  OPENROUTER_ACCEPT_ESTIMATED_BUDGET: z.enum(['true', 'false']).default('false'),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().min(100).max(90_000).default(60_000),
});
export function config(env: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid backend configuration: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  return result.data;
}
