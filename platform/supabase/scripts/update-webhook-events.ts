// Sets an existing Stripe webhook endpoint's events to WEBHOOK_EVENTS.
//   pnpm --filter @backseat/supabase exec tsx scripts/update-webhook-events.ts --id <we_…>
// The signing secret and the endpoint's API version do not change. This edits a
// live Stripe resource; run it only with the board's yes.

import { loadRepoEnv } from "../lib/client.js";
import { requireEnv } from "../lib/env.js";
import { WEBHOOK_EVENTS } from "../functions/_shared/webhook_events.ts";

function parseArgs(argv: string[]): { id: string } {
  let id: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--id" && value) id = value;
    else throw new Error(`Unknown argument ${key}`);
  }
  if (!id || !/^we_[A-Za-z0-9]+$/.test(id)) {
    throw new Error("--id <we_… endpoint id> is required");
  }
  return { id };
}

interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
  api_version: string | null;
}

async function main(): Promise<void> {
  const { id } = parseArgs(process.argv.slice(2));
  const env = loadRepoEnv();
  const key = requireEnv(env, "STRIPE_SECRET_KEY");

  const form = new URLSearchParams();
  for (const event of WEBHOOK_EVENTS) form.append("enabled_events[]", event);

  const res = await fetch(`https://api.stripe.com/v1/webhook_endpoints/${id}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const body = (await res.json()) as WebhookEndpoint | { error: { message: string } };
  if (!res.ok || "error" in body) {
    const message = "error" in body ? body.error.message : `status ${res.status}`;
    throw new Error(`Stripe refused the update: ${message}`);
  }

  console.log(`endpoint id: ${body.id}`);
  console.log(`url: ${body.url}`);
  console.log(`status: ${body.status}`);
  console.log(`api version: ${body.api_version ?? "account default"}`);
  console.log(`events: ${body.enabled_events.join(", ")}`);
}

main().catch((err: unknown) => {
  console.error(`update-webhook-events failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
