import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8787),
  PUBLIC_BASE_URL: z.url().optional(),
  DATABASE_URL: z.string().default("file:./data/nonna.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DIAL_API_URL: z.url().default("https://api.getdial.ai"),
  DIAL_API_KEY: z.string().min(1),
  DIAL_WEBHOOK_SECRET: z.string().min(1),
  DIAL_FRONT_DOOR_NUMBER: z.string().min(1),
  DIAL_WORKER_NUMBER: z.string().min(1),

  DARWIN_API_URL: z.url().default("https://api.darwin.so"),
  DARWIN_SEARCH_KEY: z.string().optional(),
  DARWIN_ACT_KEY: z.string().optional(),
  DARWIN_ACT_ENABLED: z.stringbool().default(false),

  OMB_API_URL: z.url().default("http://localhost:8799"),
  OMB_API_TOKEN: z.string().optional(),
});
export type Env = z.infer<typeof Env>;

/** Parse and validate env once at startup. Fails fast with a readable list of problems. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
