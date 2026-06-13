import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CRM_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default("postgresql://localhost:5432/xeno"),
  DIRECT_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32).default("xeno-jwt-secret-default-change-me-in-production-32ch!"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  FRONTEND_URL: z.string().url().default("https://xeno-frontend-kappa.vercel.app"),
  CHANNEL_WEBHOOK_SECRET: z.string().min(32).default("xeno-webhook-secret-default-change-me-in-production-32ch!"),
  CHANNEL_SERVICE_URL: z.string().url().default("http://localhost:3001"),
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com"),
  XIAOMI_AUTH_TOKEN: z.string().min(1).default("placeholder"),
  XIAOMI_MODEL: z.string().default("mimo-v2.5-pro"),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@xeno.local"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("XenoDemo123!")
});

export type Environment = z.infer<typeof envSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const normalized = {
    ...config,
    DATABASE_URL: config.DATABASE_URL ?? config.NEON_DB,
    DIRECT_URL: config.DIRECT_URL ?? config.DATABASE_URL ?? config.NEON_DB
  };
  return envSchema.parse(normalized);
}
