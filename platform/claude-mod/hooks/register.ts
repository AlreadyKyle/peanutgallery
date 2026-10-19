// The Dust mod's hooks module. `/dust` opens Dust in the person's browser, tagged ?from=claude-code
// and nothing else, and prints the link too, so it still works where no browser can be opened (a
// remote or cloud session). It is registered `immediate`, so it runs while a turn is still going.
//
// The long-turn hint is off unless the person turns it on (the `longTurnHint` option, a row in
// /config). When on, it shows one short notice, at most once a session, after a turn has run for two
// minutes. It never opens anything by itself. Nothing here keeps a count, a streak or a timer the
// person can see, and nothing is sent anywhere.
import type { EngineInterface, Register, Timer } from 'claude-code'

export const DUST_URL = 'https://play.mobmachine.games/?from=claude-code'
export const HINT_AFTER_MS = 2 * 60 * 1000
export const HINT_TEXT = 'Claude is still working. Type /dust to play Dust in your browser while you wait.'

// The host's own opener for a web address: rundll32 on Windows, open on macOS, xdg-open elsewhere.
async function openerFor($: EngineInterface): Promise<string[]> {
  if ((await $.env.get('OS')) === 'Windows_NT') return ['rundll32', 'url.dll,FileProtocolHandler', DUST_URL];
  const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => undefined);
  return uname?.stdout.trim() === 'Darwin' ? ['open', DUST_URL] : ['xdg-open', DUST_URL];
}

async function openInBrowser($: EngineInterface): Promise<boolean> {
  try {
    const ran = await $.process.run(await openerFor($), { timeoutMs: 10000 });
    return ran.exitCode === 0;
  } catch {
    return false;
  }
}

export const register: Register = (on, options) => {
  const isHintOn = options.longTurnHint === true;
  let hasHinted = false;
  let timer: Timer | undefined;

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dust',
      description: "Open Dust, Mob Machine's idle game, in your browser while Claude works",
      immediate: true,
    });

    return next(e);
  });

  on('command.run', { command: 'dust' }, async $ => {
    hasHinted = true;
    timer?.cancel();
    timer = undefined;

    return (await openInBrowser($))
      ? { text: `Opened Dust in your browser: ${DUST_URL}` }
      : { text: `Open Dust in your browser: ${DUST_URL}` };
  });

  on('turn.start', ($, e, next) => {
    if (!isHintOn || hasHinted || e.agentId !== undefined) return next(e);
    timer?.cancel();
    timer = $.clock.after(HINT_AFTER_MS, () => {
      timer = undefined;
      if (hasHinted) return;
      hasHinted = true;
      $.ui.toast(HINT_TEXT, { timeoutMs: 15000 });
    });

    return next(e);
  });

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      timer?.cancel();
      timer = undefined;
    }

    return next(e);
  });
};
