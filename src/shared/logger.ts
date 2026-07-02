import pino from "pino";
import { getDb } from "./db.js";

export type LogContext = Record<string, unknown>;

export type AppLogger = {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(bindings: LogContext): AppLogger;
};

const SENSITIVE_KEYS = new Set([
  "apiKey",
  "apikey",
  "token",
  "secret",
  "password",
  "authorization",
  "supabaseKey",
  "geminiApiKey",
  "anthropicApiKey",
  "openrouterApiKey",
  "telegramBotToken",
  "telegramChatId",
]);

function buildBaseLogger() {
  const isCi = process.env.CI === "true";
  const pretty = process.env.LOG_PRETTY === "true" || (!isCi && process.env.NODE_ENV !== "production");

  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: undefined,
    redact: {
      paths: [
        "apiKey",
        "*.apiKey",
        "*.token",
        "*.secret",
        "*.password",
        "authorization",
        "supabaseKey",
        "geminiApiKey",
        "anthropicApiKey",
        "openrouterApiKey",
        "telegramBotToken",
        "telegramChatId",
      ],
      censor: "[REDACTED]",
    },
    transport: pretty
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
            singleLine: false,
          },
        }
      : undefined,
  });
}

const rootLogger = buildBaseLogger();

function redactSecrets(value: string): string {
  const secrets = [
    process.env.SUPABASE_KEY,
    process.env.SUPABASE_URL,
    process.env.OPENROUTER_API_KEY,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID,
  ].filter((secret): secret is string => Boolean(secret && secret.length >= 6));

  let result = value;
  for (const secret of secrets) {
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSecrets(value.message),
      stack: value.stack ? redactSecrets(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitize(child);
      }
    }
    return result;
  }
  return String(value);
}

function normalizeContext(context?: LogContext): LogContext | undefined {
  if (!context || Object.keys(context).length === 0) return undefined;
  return sanitize(context) as LogContext;
}

function isPlainObject(value: unknown): value is LogContext {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Error);
}

function normalizeArgs(args: unknown[]): { message: string; context?: LogContext } {
  if (args.length === 0) {
    return { message: "" };
  }

  const [first, ...rest] = args;

  if (typeof first === "string") {
    const context = rest.length > 0 ? ({ args: sanitize(rest) as unknown } as LogContext) : undefined;
    return { message: redactSecrets(first), context };
  }

  if (first instanceof Error) {
    const context = rest.length > 0
      ? ({ error: sanitize(first), args: sanitize(rest) as unknown } as LogContext)
      : ({ error: sanitize(first) } as LogContext);
    return { message: redactSecrets(first.message), context };
  }

  if (isPlainObject(first)) {
    const safeFirst = sanitize(first) as LogContext;
    const message = typeof safeFirst.message === "string" ? String(safeFirst.message) : "";
    if (rest.length > 0) {
      return { message, context: { ...safeFirst, args: sanitize(rest) as unknown } };
    }
    return { message, context: safeFirst };
  }

  const message = redactSecrets(String(first));
  const context = rest.length > 0 ? ({ args: sanitize(rest) as unknown } as LogContext) : undefined;
  return { message, context };
}

async function persistLog(level: "warn" | "error", source: string, message: string, context?: LogContext): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;

  try {
    const { error } = await ((getDb().from("logs") as any).insert({
      timestamp: new Date().toISOString(),
      level,
      message,
      context: context ?? {},
      source,
    }) as Promise<{ error?: { message?: string } }>);

    if (error) {
      rootLogger.warn(
        { source, context: normalizeContext({ level, dbError: error.message }) },
        "Failed to persist log entry to Supabase",
      );
    }
  } catch (error) {
    rootLogger.warn(
      { source, context: normalizeContext({ level, error }) },
      "Failed to persist log entry to Supabase",
    );
  }
}

function createStructuredLogger(source: string, inheritedContext: LogContext = {}): AppLogger {
  const bindings = { source, ...(sanitize(inheritedContext) as Record<string, unknown>) };
  const child = rootLogger.child(bindings);

  const emit = (level: "debug" | "info" | "warn" | "error", ...args: unknown[]) => {
    const { message, context } = normalizeArgs(args);
    const safeContext = normalizeContext(context);
    const payload = safeContext ? { ...safeContext } : undefined;

    if (payload) {
      if (message) {
        child[level](payload, message);
      } else {
        child[level](payload);
      }
    } else {
      child[level](message);
    }

    if (level === "warn" || level === "error") {
      void persistLog(level, source, message, safeContext);
    }
  };

  return {
    debug: (...args) => emit("debug", ...args),
    info: (...args) => emit("info", ...args),
    warn: (...args) => emit("warn", ...args),
    error: (...args) => emit("error", ...args),
    child: (bindings: LogContext) => createStructuredLogger(source, { ...inheritedContext, ...bindings }),
  };
}

export const logger = createStructuredLogger("app");

export function createLogger(source: string): AppLogger {
  return createStructuredLogger(source);
}
