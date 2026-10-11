type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Logger = Record<Level, (msg: string, fields?: Record<string, unknown>) => void>;

/**
 * Minimal structured JSON logger. Never log message bodies, transcripts or other health data
 * at info level — log ids and event types instead.
 */
export function createLogger(min: Level = "info"): Logger {
  const emit = (level: Level) => (msg: string, fields?: Record<string, unknown>) => {
    if (order[level] < order[min]) return;
    const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields });
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}
