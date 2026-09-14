// The dispatcher's pre-check (platform/dispatcher/src/pipeline.ts), run before
// a card is filed so a card the dispatcher would reject is never inserted. The
// dispatcher rejects a card whose check: lines do not parse
// (acceptance_grammar), and a card with at least one check whose checks all
// already hold (acceptance_already_true). A file that cannot be read or parsed
// counts as not holding, as it does in the dispatcher.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AcceptanceGrammarError, evaluateCheck, parseChecks, type ConfigCheck } from "../../dispatcher/src/acceptance.ts";

export interface PreCheckRejection {
  failingCheck: "acceptance_grammar" | "acceptance_already_true";
  detail: string;
}

async function checksHold(root: string, checks: readonly ConfigCheck[]): Promise<boolean> {
  for (const check of checks) {
    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(join(root, check.file), "utf8"));
    } catch {
      return false;
    }
    if (!evaluateCheck(check, doc)) return false;
  }
  return true;
}

/** Null when the pre-check would pass the card against the files under root; otherwise the failing check. */
export async function preCheckRejection(acceptanceTest: string | null, root: string): Promise<PreCheckRejection | null> {
  let checks: ConfigCheck[];
  try {
    checks = parseChecks(acceptanceTest);
  } catch (error) {
    if (error instanceof AcceptanceGrammarError) {
      return { failingCheck: "acceptance_grammar", detail: error.message };
    }
    throw error;
  }
  if (checks.length > 0 && (await checksHold(root, checks))) {
    return { failingCheck: "acceptance_already_true", detail: "every check: line already holds" };
  }
  return null;
}
