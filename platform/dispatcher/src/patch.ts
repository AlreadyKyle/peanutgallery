// A card's change as a patch: the file an unattended Managed Agents session hands back through
// submit_patch, and the copy stored in card_patches so a card that pauses or re-queues after its patch
// was accepted is re-gated from it without a new session (docs/specs/launch-managed.md).
//
// Nothing is written to the worktree until the patch passes every check. `git apply --check
// --numstat --summary -z` reads it without writing, and the patch is refused when it:
// - is larger than PATCH_MAX_BYTES or changes more than PATCH_MAX_FILES files;
// - carries a binary change (a "Binary files" or "GIT binary patch" hunk, or a "-" numstat count);
// - renames or copies a file;
// - creates, deletes or changes any mode other than 100644 and 100755 (so no symlink, 120000, and no
//   submodule, 160000);
// - touches a path outside the card's lane, a kernel path, or a path with a . or .. or .git segment.
// Only then is it applied, with core.symlinks off and never with --unsafe-paths. The pipeline's own
// checks (the git state, the acceptance post-check, the local and remote range checks) still follow.
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout, SUPABASE_TIMEOUT_MS } from './db.js';
import { git, outsideLane } from './worktree.js';

export const PATCH_FILE = 'card.patch';
export const PATCH_MAX_BYTES = 1_048_576;
export const PATCH_MAX_FILES = 100;
export const ALLOWED_MODES: readonly string[] = ['100644', '100755'];

export type PatchCheck = { ok: true; files: string[] } | { ok: false; reason: string };

export function patchSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// The checks that read the patch text alone.
export function patchTextProblem(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return 'the patch is empty';
  if (bytes.byteLength > PATCH_MAX_BYTES) return `the patch is ${bytes.byteLength} bytes, over the ${PATCH_MAX_BYTES}-byte limit`;
  // card_patches stores the patch as text, so only bytes that are valid UTF-8 survive the round trip.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return 'the patch is not valid UTF-8';
  }
  if (text.includes('\0')) return 'the patch contains a NUL byte';
  if (/^GIT binary patch$/m.test(text) || /^Binary files .* differ$/m.test(text)) return 'the patch changes a binary file';
  if (/^(rename|copy) (from|to) /m.test(text)) return 'the patch renames or copies a file; make it with --no-renames';
  for (const match of text.matchAll(/^(?:new file mode|deleted file mode|old mode|new mode) (\d+)$/gm)) {
    if (!ALLOWED_MODES.includes(match[1] ?? '')) return `the patch uses file mode ${match[1]}; only regular files (100644, 100755) are allowed`;
  }
  for (const match of text.matchAll(/^index [0-9a-f]+\.\.[0-9a-f]+ (\d+)$/gm)) {
    if (!ALLOWED_MODES.includes(match[1] ?? '')) return `the patch uses file mode ${match[1]}; only regular files (100644, 100755) are allowed`;
  }
  return null;
}

export interface ApplyReport {
  // Each path the numstat lists, and whether its counts are binary ("-").
  entries: Array<{ path: string; binary: boolean }>;
  // The --summary lines, trimmed.
  summary: string[];
}

// `git apply --numstat --summary -z` prints NUL-ended numstat entries ("added\tdeleted\tpath"), then
// newline-ended summary lines, each starting with a space.
export function parseApplyReport(output: string): ApplyReport {
  const lastNul = output.lastIndexOf('\0');
  const numstat = lastNul >= 0 ? output.slice(0, lastNul) : '';
  const rest = lastNul >= 0 ? output.slice(lastNul + 1) : output;
  const entries = numstat
    .split('\0')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [added = '', deleted = '', ...name] = entry.split('\t');
      return { path: name.join('\t'), binary: added === '-' || deleted === '-' };
    });
  const summary = rest
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { entries, summary };
}

// Why the report refuses the patch, or null.
export function reportProblem(report: ApplyReport, allowed: readonly string[]): string | null {
  if (report.entries.length === 0) return 'the patch changes no file';
  if (report.entries.length > PATCH_MAX_FILES) return `the patch changes ${report.entries.length} files, over the ${PATCH_MAX_FILES}-file limit`;
  const binary = report.entries.filter((entry) => entry.binary).map((entry) => entry.path);
  if (binary.length > 0) return `the patch changes binary files: ${binary.join(', ')}`;
  const unsafe = report.entries
    .map((entry) => entry.path)
    .filter((file) => file.length === 0 || file.startsWith('/') || file.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || segment.toLowerCase() === '.git'));
  if (unsafe.length > 0) return `the patch names unsafe paths: ${unsafe.join(', ')}`;
  const stray = outsideLane(
    report.entries.map((entry) => entry.path),
    allowed,
  );
  if (stray.length > 0) return `the patch changes files outside the lane or on a kernel path: ${stray.join(', ')}`;
  for (const line of report.summary) {
    const created = /^(?:create|delete) mode (\d+) /.exec(line);
    if (created) {
      if (!ALLOWED_MODES.includes(created[1] ?? '')) return `the patch uses file mode ${created[1]}: ${line}`;
      continue;
    }
    const changed = /^mode change (\d+) => (\d+) /.exec(line);
    if (changed) {
      if (!ALLOWED_MODES.includes(changed[1] ?? '') || !ALLOWED_MODES.includes(changed[2] ?? '')) return `the patch changes a file mode to or from a special mode: ${line}`;
      continue;
    }
    return `the patch summary has a line the dispatcher does not accept: ${line}`;
  }
  return null;
}

const APPLY = ['-c', 'core.symlinks=false', 'apply'];

// Checks the patch against the worktree without writing, then applies it. The patch file is written
// outside the worktree and removed afterwards.
export async function validateAndApply(worktree: string, bytes: Uint8Array, allowed: readonly string[]): Promise<PatchCheck> {
  const textProblem = patchTextProblem(bytes);
  if (textProblem) return { ok: false, reason: textProblem };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-patch-'));
  const file = path.join(dir, PATCH_FILE);
  try {
    await writeFile(file, bytes);
    let report: ApplyReport;
    try {
      report = parseApplyReport(await git([...APPLY, '--check', '--numstat', '--summary', '-z', file], worktree));
    } catch (error) {
      const detail = error instanceof Error ? (error.message.split('\n').find((line) => line.startsWith('error:')) ?? error.message.split('\n')[0]) : String(error);
      return { ok: false, reason: `the patch does not apply at the base commit: ${detail}` };
    }
    const problem = reportProblem(report, allowed);
    if (problem) return { ok: false, reason: problem };
    await git([...APPLY, file], worktree);
    return { ok: true, files: report.entries.map((entry) => entry.path).sort() };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// card_patches (platform/supabase/migrations/20260922000200_dispatcher_lease.sql): service role only.
// The dispatcher writes each patch it accepted, as text, with the base commit it applied to, its
// sha256 and byte count (the table refuses a row whose digest or length does not match the text), the
// agent's one-line summary and the session it came from; it reads back the newest one for a card.
export interface StoredPatch {
  cardId: string;
  baseSha: string;
  patch: string;
  sha256: string;
  bytes: number;
  summary: string | null;
  sessionId: string | null;
}

// A row for patch bytes that passed patchTextProblem, so they are valid UTF-8 and the text is exact.
export function storedPatch(cardId: string, baseSha: string, bytes: Uint8Array, summary: string | null, sessionId: string | null): StoredPatch {
  return { cardId, baseSha, patch: Buffer.from(bytes).toString('utf8'), sha256: patchSha256(bytes), bytes: bytes.byteLength, summary, sessionId };
}

export interface PatchStore {
  save(patch: StoredPatch): Promise<void>;
  latest(cardId: string): Promise<StoredPatch | null>;
  // Removes every stored patch for the card, so the next claim runs a new session.
  discard(cardId: string): Promise<void>;
}

export const PATCH_TABLE = 'card_patches';

export function createSupabasePatchStore(url: string, serviceRoleKey: string, fetchFn: typeof fetch = fetch): PatchStore {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout(fetchFn, SUPABASE_TIMEOUT_MS) },
  });
  return {
    async save(patch) {
      const { error } = await client.from(PATCH_TABLE).insert({
        card_id: patch.cardId,
        base_sha: patch.baseSha,
        patch: patch.patch,
        sha256: patch.sha256,
        bytes: patch.bytes,
        summary: patch.summary,
        session_id: patch.sessionId,
      });
      if (error) throw new Error(`db ${PATCH_TABLE} insert: ${error.message}`);
    },
    async latest(cardId) {
      const { data, error } = await client
        .from(PATCH_TABLE)
        .select('card_id, base_sha, patch, sha256, bytes, summary, session_id')
        .eq('card_id', cardId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(`db ${PATCH_TABLE} read: ${error.message}`);
      const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
      if (!row || typeof row.patch !== 'string' || typeof row.base_sha !== 'string' || typeof row.sha256 !== 'string') return null;
      return {
        cardId,
        baseSha: row.base_sha,
        patch: row.patch,
        sha256: row.sha256,
        bytes: typeof row.bytes === 'number' ? row.bytes : Buffer.byteLength(row.patch, 'utf8'),
        summary: typeof row.summary === 'string' ? row.summary : null,
        sessionId: typeof row.session_id === 'string' ? row.session_id : null,
      };
    },
    async discard(cardId) {
      const { error } = await client.from(PATCH_TABLE).delete().eq('card_id', cardId);
      if (error) throw new Error(`db ${PATCH_TABLE} delete: ${error.message}`);
    },
  };
}

export type StoredPatchOutcome = { kind: 'none' } | { kind: 'applied'; sha256: string; baseSha: string; files: string[] } | { kind: 'conflict'; sha256: string; detail: string };

// The pipeline's hook before a session: a card with a stored patch is rebuilt from it at the new base
// and runs no session. A patch that no longer applies, or that a check refuses, is discarded so the
// board's next resume runs a new session; the pipeline pauses the card.
export async function applyStoredPatch(store: PatchStore, cardId: string, worktree: string, allowed: readonly string[]): Promise<StoredPatchOutcome> {
  const stored = await store.latest(cardId);
  if (!stored) return { kind: 'none' };
  const bytes = Buffer.from(stored.patch, 'utf8');
  const sha256 = patchSha256(bytes);
  if (sha256 !== stored.sha256) {
    await store.discard(cardId);
    return { kind: 'conflict', sha256, detail: `the stored text hashes to ${sha256}, not the recorded ${stored.sha256}` };
  }
  const check = await validateAndApply(worktree, bytes, allowed);
  if (check.ok) return { kind: 'applied', sha256, baseSha: stored.baseSha, files: check.files };
  await store.discard(cardId);
  return { kind: 'conflict', sha256, detail: check.reason };
}
