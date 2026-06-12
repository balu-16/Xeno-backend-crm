import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CRM_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("8h"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_USERNAME: z.string().default("default"),
  REDIS_PASSWORD: z.string().min(1),
  REDIS_TLS: booleanString,
  CHANNEL_WEBHOOK_SECRET: z.string().min(32),
  CHANNEL_SERVICE_URL: z.string().url().optional(),
  ANTHROPIC_BASE_URL: z.string().url(),
  XIAOMI_AUTH_TOKEN: z.string().min(1),
  XIAOMI_MODEL: z.string().default("mimo-v2.5-pro"),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@xeno.local"),
  SEED_ADMIN_PASSWORD: z.string().min(8)
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
