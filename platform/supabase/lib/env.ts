// Pure environment helpers shared by seed.ts and the scripts.

export type Env = Record<string, string | undefined>;

export function requireEnv(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set in .env`);
  }
  return value;
}

/** A non-negative dollar amount from the environment, e.g. POOL_DAILY_CAP_USD. */
export function requireUsd(env: Env, name: string): number {
  const raw = requireEnv(env, name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a number of dollars, got "${raw}"`);
  }
  return Math.round(value * 10000) / 10000;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Comma-separated emails → lowercased, trimmed, de-duplicated, validated. */
export function parseEmailList(value: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (value ?? "").split(",")) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_PATTERN.test(email)) {
      throw new Error(`"${part.trim()}" is not an email address`);
    }
    if (!seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

export interface BoardMember {
  email: string;
  role: "board" | "moderator";
}

/** BOARD_EMAILS become board rows; MODERATOR_EMAIL (optional) a moderator row. A board email wins over the moderator setting. */
export function parseBoardMembers(boardEmails: string | undefined, moderatorEmail: string | undefined): BoardMember[] {
  const board = parseEmailList(boardEmails);
  if (board.length === 0) {
    throw new Error("BOARD_EMAILS must list at least one address");
  }
  const members: BoardMember[] = board.map((email) => ({ email, role: "board" }));
  for (const email of parseEmailList(moderatorEmail)) {
    if (!board.includes(email)) {
      members.push({ email, role: "moderator" });
    }
  }
  return members;
}

/** Calendar date in America/New_York as YYYY-MM-DD. */
export function todayInNewYork(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
