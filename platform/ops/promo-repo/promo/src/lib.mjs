// Shared helpers for the promo engine: where its files live and how they are read and written.
// Everything the engine knows is a file in promo/, so a run can pick up from git alone.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Post length limits per channel, in characters. */
export const LIMITS = { x: 280, bluesky: 300, threads: 500, mastodon: 500, linkedin: 3000, discord: 2000, youtube: 1000, tiktok: 2200, instagram: 2200 };

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function paths(root = ROOT) {
  return {
    root,
    config: join(root, 'config.json'),
    playbook: join(root, 'playbook.json'),
    outbox: join(root, 'outbox'),
    sent: join(root, 'sent'),
    metrics: join(root, 'metrics'),
    seen: join(root, 'state', 'seen.json'),
  };
}

export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

export function loadConfig(root = ROOT) {
  return readJson(paths(root).config, null);
}

/** Every draft in the outbox, oldest first. */
export function listOutbox(root = ROOT) {
  const dir = paths(root).outbox;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(join(dir, name)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function saveDraft(draft, root = ROOT) {
  writeJson(join(paths(root).outbox, `${draft.id}.json`), draft);
}

export function removeDraft(id, root = ROOT) {
  rmSync(join(paths(root).outbox, `${id}.json`), { force: true });
}

/** Receipts are one JSON line per sent post, a file a month. */
export function appendSent(receipt, root = ROOT) {
  const file = join(paths(root).sent, `${receipt.sentAt.slice(0, 7)}.jsonl`);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(receipt)}\n`);
}

export function readSent(root = ROOT) {
  const dir = paths(root).sent;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
}

export function slug(text, max = 40) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max);
}

export function dayOf(iso) {
  return iso.slice(0, 10);
}

export function money(usd) {
  const n = Number(usd);
  return `$${n.toFixed(2)}`;
}
