// Why the process stopped, as one phrase from a fixed list. The Actions host shows only fixed
// lifecycle lines in its public log (platform/ops/actions/run-dispatcher.sh), so before this a fatal
// startup said only "exited with an error": a spent Console balance, an expired read token and a
// drifted managed agent all looked the same until the board decrypted the log. The phrase is chosen
// from the error's text but carries none of it, so it is safe to print in public; the full message
// stays in the encrypted log.
import { ConfigError } from './config.js';
import { spendRefusal } from './credit.js';
import { errorMessage } from './log.js';

export const STOP_REASONS = [
  'configuration refused',
  'git configuration refused',
  'code root writable',
  'role model has no price',
  'github read token refused',
  'github unreachable',
  'anthropic credit balance too low',
  'anthropic usage tier cap reached',
  'anthropic key refused',
  'anthropic permission refused',
  'managed agent or environment not found',
  'managed agent or environment differs',
  'startup probe failed',
  'probe spend not recorded',
  'anthropic api error',
  'unclassified',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

// The lifecycle message main.ts logs on a failed exit: "stop reason: <phrase>".
export function stopReasonMessage(reason: StopReason): string {
  return `stop reason: ${reason}`;
}

// The read token's own failures are checked before the API's, since their text names GitHub's
// status codes, which would otherwise read as the Anthropic API's.
export function stopReason(error: unknown): StopReason {
  if (error instanceof ConfigError) return 'configuration refused';
  const text = errorMessage(error);
  if (/git configuration|remote\.origin\.url/.test(text)) return 'git configuration refused';
  if (/the code root .* is writable/.test(text)) return 'code root writable';
  if (/no price (in PRICE_TABLE_JSON|for model)/.test(text)) return 'role model has no price';
  if (/GITHUB_READ_TOKEN/.test(text)) return /could not reach GitHub|could not be checked|rate limited|returned 5\d\d/.test(text) ? 'github unreachable' : 'github read token refused';
  const refusal = spendRefusal(text);
  if (refusal === 'credit') return 'anthropic credit balance too low';
  if (refusal === 'tier_cap') return 'anthropic usage tier cap reached';
  if (/differs from platform\/agents\/managed|differs from .*agent\.yaml|the agent is archived/.test(text)) return 'managed agent or environment differs';
  if (/\b401\b|authentication_error|invalid x-api-key/i.test(text)) return 'anthropic key refused';
  if (/\b403\b|permission_error/i.test(text)) return 'anthropic permission refused';
  if (/\b404\b|not_found_error/i.test(text)) return 'managed agent or environment not found';
  if (/the ledger refused probe rows/.test(text)) return 'probe spend not recorded';
  if (/startup probe failed|probe session could not be created/.test(text)) return 'startup probe failed';
  if (/could not be (read|created)|\b(400|408|409|422|429|5\d\d)\b/.test(text)) return 'anthropic api error';
  return 'unclassified';
}
