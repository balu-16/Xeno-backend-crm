import { z } from "zod";

/**
 * For optional URL env vars: if the raw value is missing, empty, or not a
 * valid URL, fall back to `defaultValue`.  This prevents Vercel's empty-string
 * env vars (or stale "true"/"1" placeholders) from crashing the app.
 */
function optionalUrl(defaultValue: string) {
  return z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === "") return defaultValue;
      const s = String(val).trim();
      // Only accept values that look like absolute URLs with a scheme.
      if (/^https?:\/\/.+/.test(s)) return s;
      return defaultValue;
    },
    z.string(),
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CRM_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32).default("xeno-jwt-secret-default-change-me-in-production-32ch!"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  FRONTEND_URL: optionalUrl("http://localhost:5173"),
  CHANNEL_WEBHOOK_SECRET: z.string().min(32).default("xeno-webhook-secret-default-change-me-in-production-32ch!"),
  CHANNEL_SERVICE_URL: optionalUrl("http://localhost:3001"),
  ANTHROPIC_BASE_URL: optionalUrl("https://api.anthropic.com"),
  XIAOMI_AUTH_TOKEN: z.string().min(1).default("placeholder"),
  XIAOMI_MODEL: z.string().default("mimo-v2.5-pro"),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@xeno.local"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("XenoDemo123!"),
});

export type Environment = z.infer<typeof envSchema>;

function ensureConnectTimeout(url: string, seconds = 5): string {
  const separator = url.includes("?") ? "&" : "?";
  return url.includes("connect_timeout")
    ? url
    : `${url}${separator}connect_timeout=${seconds}`;
}

export function validateEnvironment(config: Record<string, unknown>) {
  // Strip empty / whitespace-only strings so Zod defaults can kick in.
  // Vercel may set env vars to "" which bypasses .default() in Zod.
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && value.trim() === "") continue;
    cleaned[key] = value;
  }

  const rawDbUrl = cleaned.DATABASE_URL as string;
  const normalized = {
    ...cleaned,
    DATABASE_URL: ensureConnectTimeout(rawDbUrl),
    DIRECT_URL: ensureConnectTimeout(
      (cleaned.DIRECT_URL as string) ?? rawDbUrl,
    ),
  };
  return envSchema.parse(normalized);
}
