function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function formatFetchErrorDetails(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  } else if (typeof error === "string" && error.trim()) {
    parts.push(error.trim());
  }

  const record = readRecord(error);
  const cause = readRecord(record?.cause);
  const details = cause ?? record;

  const code = readString(details?.code);
  const errno = readString(details?.errno);
  const syscall = readString(details?.syscall);
  const hostname = readString(details?.hostname) ?? readString(details?.host);
  const address = readString(details?.address);
  const port = readString(details?.port);
  const causeMessage = readString(details?.message);

  if (code && !parts.includes(code)) parts.push(code);
  if (errno && !parts.includes(errno)) parts.push(`errno=${errno}`);
  if (syscall) parts.push(`syscall=${syscall}`);
  if (hostname) parts.push(`host=${hostname}`);
  if (address) parts.push(`address=${address}`);
  if (port) parts.push(`port=${port}`);
  if (causeMessage && !parts.includes(causeMessage)) parts.push(causeMessage);

  return parts.filter(Boolean).join(" | ") || "Unknown network error";
}
