type RateLimitState = {
  tail: Promise<void>;
  timestamps: number[];
};

type ConfiguredRateLimit = {
  key: string;
  envVar: string;
  defaultRpm: number;
  windowMs?: number;
};

const DEFAULT_WINDOW_MS = 60_000;
const states = new Map<string, RateLimitState>();

function getState(key: string): RateLimitState {
  const existing = states.get(key);
  if (existing) {
    return existing;
  }

  const created: RateLimitState = {
    tail: Promise.resolve(),
    timestamps: [],
  };
  states.set(key, created);
  return created;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value: string, envVar: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envVar} must be a positive integer`);
  }

  return parsed;
}

export function getConfiguredRateLimitRpm(envVar: string, defaultRpm: number): number {
  const raw = process.env[envVar]?.trim();
  if (!raw) {
    return defaultRpm;
  }

  return parsePositiveInteger(raw, envVar);
}

async function acquireRateLimitSlot(key: string, rpm: number, windowMs: number): Promise<void> {
  const state = getState(key);

  const run = async (): Promise<void> => {
    while (true) {
      const now = Date.now();
      state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < windowMs);

      if (state.timestamps.length < rpm) {
        state.timestamps.push(now);
        return;
      }

      const oldestTimestamp = state.timestamps[0];
      const waitMs = Math.max(0, windowMs - (now - oldestTimestamp));
      await sleep(waitMs);
    }
  };

  const next = state.tail.then(run, run);
  state.tail = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

export async function withRateLimit<T>(key: string, rpm: number, fn: () => Promise<T>, windowMs = DEFAULT_WINDOW_MS): Promise<T> {
  await acquireRateLimitSlot(key, rpm, windowMs);
  return fn();
}

export async function withConfiguredRateLimit<T>(
  config: ConfiguredRateLimit,
  fn: () => Promise<T>,
): Promise<T> {
  const rpm = getConfiguredRateLimitRpm(config.envVar, config.defaultRpm);
  return withRateLimit(config.key, rpm, fn, config.windowMs);
}

export function resetRateLimitStateForTests(): void {
  states.clear();
}
