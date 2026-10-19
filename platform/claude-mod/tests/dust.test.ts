// The Dust mod's behaviour, run by `claude plugin test platform/claude-mod`: /dust opens the tagged
// link and prints it, and the long-turn hint is off by default, shows once a session when on, and
// never opens anything by itself.
import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const URL = 'https://play.mobmachine.games/?from=claude-code';
const HINT = 'Claude is still working. Type /dust to play Dust in your browser while you wait.';
const TWO_MINUTES = 2 * 60 * 1000;
const RUN = { command: 'dust', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const;
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const;

// The world beneath the mod: a host (`uname -s` answers `system`, `OS` is `os`) whose opener exits
// with `openerExit`, a registry of commands, and a list of what was run and toasted.
function host(on: On, { openerExit = 0, system = 'Linux', os }: { openerExit?: number; system?: string; os?: string } = {}) {
  const runs: string[][] = [];
  const toasts: string[] = [];
  const commands: { name: string; immediate?: true }[] = [];
  mock.env(on, os === undefined ? {} : { OS: os });
  on('process.run', (_$, e) => {
    runs.push([...e.argv]);
    const isUname = e.argv[0] === 'uname';
    const exitCode = isUname ? 0 : openerExit;
    return { value: { exitCode, stdout: isUname ? `${system}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on('command.register', (_$, e) => {
    commands.push({ name: e.name, immediate: e.immediate });
    return { value: { command: e.name } };
  });
  on('ui.toast', (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  on('turn.complete', () => ({ text: '' }));
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  const opened = () => runs.filter(argv => argv[0] !== 'uname');

  return { runs, opened, toasts, commands };
}

test('/dust is registered to run while a turn is going', async ($, on) => {
  const world = host(on);
  await $.session.start(START);
  expect(world.commands).toEqual([{ name: 'dust', immediate: true }]);
});

test('/dust opens the tagged link with the host opener and prints it', async ($, on) => {
  const world = host(on);
  await $.session.start(START);
  const ran = await $.command.run(RUN);
  expect(world.opened()).toEqual([['xdg-open', URL]]);
  expect(ran.text).toBe(`Opened Dust in your browser: ${URL}`);
});

test('/dust uses open on macOS', async ($, on) => {
  const mac = host(on, { system: 'Darwin' });
  await $.session.start(START);
  await $.command.run(RUN);
  expect(mac.opened()).toEqual([['open', URL]]);
});

test('/dust uses rundll32 on Windows', async ($, on) => {
  const windows = host(on, { os: 'Windows_NT' });
  await $.session.start(START);
  await $.command.run(RUN);
  expect(windows.opened()).toEqual([['rundll32', 'url.dll,FileProtocolHandler', URL]]);
});

test('/dust prints the link when no browser opens', async ($, on) => {
  const world = host(on, { openerExit: 3 });
  await $.session.start(START);
  const ran = await $.command.run(RUN);
  expect(ran.text).toBe(`Open Dust in your browser: ${URL}`);
});

test('the hint is off unless the person turns it on', async ($, on) => {
  const clock = mock.clock(on);
  const world = host(on);
  await $.session.start(START);
  await $.turn.start({ text: 'build it', turnId: 't1' });
  await clock.advance(TWO_MINUTES * 3);
  expect(world.toasts).toEqual([]);
  expect(world.opened()).toEqual([]);
});

test('the hint shows once a session, after two minutes, and opens nothing', { options: { longTurnHint: true } }, async ($, on) => {
  const clock = mock.clock(on);
  const world = host(on);
  await $.session.start(START);
  await $.turn.start({ text: 'build it', turnId: 't1' });
  await clock.advance(TWO_MINUTES - 1000);
  expect(world.toasts).toEqual([]);
  await clock.advance(1000);
  expect(world.toasts).toEqual([HINT]);
  await $.turn.complete({ answer: '', durationMs: TWO_MINUTES + 5000, isAborted: false, turnId: 't1', reason: 'answer' });
  await $.turn.start({ text: 'and the next one', turnId: 't2' });
  await clock.advance(TWO_MINUTES * 3);
  expect(world.toasts).toEqual([HINT]);
  expect(world.opened()).toEqual([]);
});

test('a short turn shows no hint', { options: { longTurnHint: true } }, async ($, on) => {
  const clock = mock.clock(on);
  const world = host(on);
  await $.session.start(START);
  await $.turn.start({ text: 'quick one', turnId: 't1' });
  await clock.advance(30 * 1000);
  await $.turn.complete({ answer: '', durationMs: 30 * 1000, isAborted: false, turnId: 't1', reason: 'answer' });
  await clock.advance(TWO_MINUTES * 3);
  expect(world.toasts).toEqual([]);
});

test('no hint after the person has already run /dust', { options: { longTurnHint: true } }, async ($, on) => {
  const clock = mock.clock(on);
  const world = host(on);
  await $.session.start(START);
  await $.turn.start({ text: 'build it', turnId: 't1' });
  await $.command.run(RUN);
  await clock.advance(TWO_MINUTES * 3);
  expect(world.toasts).toEqual([]);
});

test("a subagent's turn starts no hint", { options: { longTurnHint: true } }, async ($, on) => {
  const clock = mock.clock(on);
  const world = host(on);
  await $.session.start(START);
  await $.turn.start({ text: 'look around', turnId: 'a1', agentId: 'agent-1' });
  await clock.advance(TWO_MINUTES * 3);
  expect(world.toasts).toEqual([]);
});
