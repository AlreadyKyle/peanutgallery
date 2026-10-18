// capture.ts: pictures of Dust from the same seed, states and camera, so two versions of the game can
// be shown before and after (docs/launch/README.md, Media). It builds the checkout, serves dist/ with
// `vite preview`, makes each state the way e2e/frame-states.ts does (the sim with seed 1, stepped a
// second at a time by the headless bot) and draws it with e2e/draw.ts, the frames spec's own draw: a
// fixed, paused page clock and 3 seconds of game time, so the same build draws the same pixels.
//
// usage: pnpm --filter @backseat/seed-1 capture -- --out <dir> [--states 0,600,3600,21600]
//          [--widths 1280,390] [--root <seed-1 folder of another checkout>] [--port <n>] [--no-build]
//
// A width may be WIDTHxHEIGHT; a bare width is drawn 16:9, or 390 by 844 in proportion under 600.
// --root draws another checkout (a `git worktree add` of main, say) with this script, so a commit
// from before the script existed can be drawn too; that checkout needs its own `pnpm install`. Paths
// resolve against the folder pnpm was started from. Each state at each size writes
// dust-<seconds>s-<width>.png (the page) and dust-<seconds>s-<width>-canvas.png (the island alone),
// and capture.json records the commit, the seed, the states and the files.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { draw, START } from '../e2e/draw';

const SEED = 1;
const DEFAULT_STATES = [0, 600, 3_600, 21_600];
const DEFAULT_WIDTHS = ['1280', '390'];
const USAGE =
  'usage: pnpm --filter @backseat/seed-1 capture -- --out <dir> [--states 0,600,3600,21600] [--widths 1280,390] [--root <seed-1 dir>] [--port <n>] [--no-build]';

export interface CaptureArgs {
  out: string;
  root: string;
  states: number[];
  sizes: { width: number; height: number }[];
  port: number;
  build: boolean;
}

/** The viewport for one --widths entry: WIDTHxHEIGHT, or a width drawn 16:9 (390 by 844 in proportion under 600). */
export function sizeOf(entry: string): { width: number; height: number } {
  const match = /^(\d+)(?:x(\d+))?$/.exec(entry.trim());
  if (!match) throw new Error(`--widths: "${entry}" is not a width or WIDTHxHEIGHT`);
  const width = Number(match[1]);
  if (width < 200 || width > 3840) throw new Error(`--widths: ${width} is outside 200 to 3840`);
  const height = match[2] !== undefined ? Number(match[2]) : width < 600 ? Math.round((width * 844) / 390) : Math.round((width * 9) / 16);
  return { width, height };
}

export function parseCaptureArgs(argv: string[], base: string, packageDir: string, env: NodeJS.ProcessEnv = process.env): CaptureArgs {
  const values = new Map<string, string>();
  let build = true;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag === '--') continue;
    if (flag === '--no-build') {
      build = false;
      continue;
    }
    if (!['--out', '--states', '--widths', '--root', '--port'].includes(flag)) throw new Error(`unknown argument ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values.set(flag, value);
    i += 1;
  }
  const out = values.get('--out');
  if (out === undefined) throw new Error('--out is required');
  const states = values.has('--states') ? values.get('--states')!.split(',').map((s) => Number(s.trim())) : DEFAULT_STATES;
  for (const seconds of states) if (!Number.isInteger(seconds) || seconds < 0 || seconds > 8 * 3600) throw new Error('--states: whole seconds from 0 to 28800');
  const port = Number(values.get('--port') ?? env['E2E_PORT'] ?? 4180);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port: a port from 1024 to 65535');
  return {
    out: resolve(base, out),
    root: values.has('--root') ? resolve(base, values.get('--root')!) : packageDir,
    states: [...new Set(states)].sort((a, b) => a - b),
    sizes: (values.get('--widths')?.split(',') ?? DEFAULT_WIDTHS).map(sizeOf),
    port,
    build,
  };
}

/**
 * The saves the game reads for each state, made with the checkout's own sim and bot the way
 * e2e/frame-states.ts makes the frames' states, so each version is drawn from its own rules.
 */
export async function statesFor(root: string, seconds: number[]): Promise<Record<string, string>> {
  const load = (file: string) => import(pathToFileURL(join(root, file)).href);
  const [{ loadConfigFromDir }, { greedyTick }, { createSim }, { serializeState }] = await Promise.all([
    load('bots/config.ts'),
    load('bots/greedy.ts'),
    load('sim/sim.ts'),
    load('sim/save.ts'),
  ]);
  const config = loadConfigFromDir(join(root, 'config'));
  const saves: Record<string, string> = {};
  let state = createSim(config, SEED);
  let at = 0;
  for (const target of seconds) {
    for (; at < target; at += 1) state = greedyTick(state, config);
    saves[String(target)] = serializeState(state);
  }
  return saves;
}

function commitOf(root: string): { commit: string | null; dirty: boolean } {
  const head = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  const status = spawnSync('git', ['-C', root, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' });
  return { commit: head.status === 0 ? head.stdout.trim() : null, dirty: status.status === 0 && status.stdout.trim() !== '' };
}

async function waitFor(url: string, server: ChildProcess, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`vite preview exited with ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

export async function capture(args: CaptureArgs): Promise<string[]> {
  const vite = join(args.root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(join(args.root, 'render', 'game.ts')) || !existsSync(vite)) {
    throw new Error(`${args.root} is not an installed seed-1 folder (run pnpm install in that checkout)`);
  }
  const saveKey = /export const SAVE_KEY = '([^']+)'/.exec(readFileSync(join(args.root, 'render', 'game.ts'), 'utf8'))?.[1];
  if (!saveKey) throw new Error(`no SAVE_KEY in ${join(args.root, 'render', 'game.ts')}`);
  const saves = await statesFor(args.root, args.states);
  if (args.build) {
    const built = spawnSync('pnpm', ['build'], { cwd: args.root, stdio: 'inherit' });
    if (built.status !== 0) throw new Error(`pnpm build failed in ${args.root}`);
  }
  const baseURL = `http://127.0.0.1:${args.port}`;
  const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(args.port), '--strictPort'], { cwd: args.root, stdio: 'ignore' });
  const written: string[] = [];
  try {
    await waitFor(baseURL, server, 60_000);
    // The launch options of playwright.config.ts: SwiftShader WebGL, and the image's Chromium where set.
    const browser = await chromium.launch({
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      ...(process.env['PW_CHROMIUM_PATH'] ? { executablePath: process.env['PW_CHROMIUM_PATH'] } : {}),
    });
    try {
      mkdirSync(args.out, { recursive: true });
      const refused = new Set<string>();
      for (const seconds of args.states) {
        for (const size of args.sizes) {
          const drawn = await draw(browser, baseURL, saveKey, saves[String(seconds)]!, size);
          for (const url of drawn.refused) refused.add(url);
          for (const [suffix, bytes] of [['', drawn.page], ['-canvas', drawn.canvas]] as const) {
            const name = `dust-${seconds}s-${size.width}${suffix}.png`;
            writeFileSync(join(args.out, name), bytes);
            written.push(name);
          }
        }
      }
      const manifest = {
        ...commitOf(args.root),
        seed: SEED,
        clock: new Date(START).toISOString(),
        states: args.states,
        sizes: args.sizes,
        refused: [...refused],
        files: written,
      };
      writeFileSync(join(args.out, 'capture.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const packageDir = fileURLToPath(new URL('..', import.meta.url));
  let args: CaptureArgs;
  try {
    args = parseCaptureArgs(process.argv.slice(2), process.env['INIT_CWD'] ?? process.cwd(), resolve(packageDir));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    process.exit(2);
  }
  capture(args).then(
    (files) => console.log(`capture: ${files.length} pictures of ${args.states.length} states at ${args.sizes.map((s) => `${s.width}x${s.height}`).join(', ')} -> ${args.out}`),
    (error: unknown) => {
      console.error(`capture failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
