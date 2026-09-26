// The frames a card's gate drew (docs/specs/design-review.md). The gate's kernel frames job draws the
// base and the change and uploads the frames that differ as the design-frames artifact: a site folder
// for the public site and a game folder for the game, each holding changed.txt and, for each frame it
// lists, <name>.after.png and, when the base drew it, <name>.before.png. A card is visual exactly when
// its green gate run uploaded design-frames with at least one changed frame; the render paths live
// only in the gate's changed-paths.sh, so the dispatcher keeps no second list.
//
// The zip is unpacked with fflate (MIT) into a folder of the dispatcher's own. An entry that is not one
// of those files, a listed frame whose after file is missing, or a file that does not start with the
// PNG signature is refused: the artifact is not what the kernel job writes, so the review cannot run
// (an infrastructure stop, never the card's fault).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { downloadArtifact, gateRunForSha, listRunArtifacts, type GitHubOptions } from './github.js';

export const FRAMES_ARTIFACT = 'design-frames';
export const FRAME_SIDES = ['site', 'game'] as const;
export type FrameSide = (typeof FRAME_SIDES)[number];
// The zip GitHub serves, and each file in it: a full-page frame is a few megabytes at most.
export const FRAMES_ZIP_MAX_BYTES = 200 * 1024 * 1024;
export const FRAME_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const FRAME_FILES_MAX = 600;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FRAME_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.png$/;
const ENTRY = /^(site|game)\/(changed\.txt|[a-z0-9]+(-[a-z0-9]+)*\.(before|after)\.png)$/;

export interface Frames {
  // The folder the review session works in.
  dir: string;
  // The changed frames, each as its side and file name (site/home-375.png), in changed.txt's order.
  changed: string[];
}

export class FramesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FramesError';
  }
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

// The pair's two files for a changed frame: site/home-375.png is site/home-375.before.png and
// site/home-375.after.png.
export function framePair(changed: string): { before: string; after: string } {
  const stem = changed.replace(/\.png$/, '');
  return { before: `${stem}.before.png`, after: `${stem}.after.png` };
}

// Unpacks a design-frames zip into dir and returns its changed frames, or throws FramesError.
export async function unpackFrames(zip: Uint8Array, dir: string): Promise<Frames> {
  let entries: Record<string, Uint8Array>;
  let count = 0;
  try {
    entries = unzipSync(zip, {
      filter: (file) => {
        count += 1;
        if (count > FRAME_FILES_MAX) throw new FramesError(`the artifact holds more than ${FRAME_FILES_MAX} files`);
        if (file.originalSize > FRAME_FILE_MAX_BYTES) throw new FramesError(`${file.name} is over ${FRAME_FILE_MAX_BYTES} bytes`);
        return !file.name.endsWith('/');
      },
    });
  } catch (error) {
    if (error instanceof FramesError) throw error;
    throw new FramesError(`the artifact is not a readable zip: ${error instanceof Error ? error.message : String(error)}`);
  }
  const names = Object.keys(entries).sort();
  const stray = names.filter((name) => !ENTRY.test(name));
  if (stray.length > 0) throw new FramesError(`the artifact holds files the frames job does not write: ${stray.slice(0, 5).join(', ')}`);
  await mkdir(dir, { recursive: true });
  for (const side of FRAME_SIDES) await mkdir(path.join(dir, side), { recursive: true });
  for (const name of names) {
    const bytes = entries[name]!;
    if (name.endsWith('.png') && !isPng(bytes)) throw new FramesError(`${name} is not a PNG`);
    await writeFile(path.join(dir, name), bytes);
  }
  const sides = FRAME_SIDES.filter((side) => names.includes(`${side}/changed.txt`));
  if (sides.length === 0) throw new FramesError('the artifact holds no changed.txt');
  const changed: string[] = [];
  for (const side of sides) {
    const listed = (await readFile(path.join(dir, side, 'changed.txt'), 'utf8')).split('\n').filter((line) => line !== '');
    for (const name of listed) {
      if (!FRAME_NAME.test(name)) throw new FramesError(`${side}/changed.txt lists ${JSON.stringify(name.slice(0, 80))}, which is not a frame name`);
      const pair = framePair(`${side}/${name}`);
      if (!names.includes(pair.after)) throw new FramesError(`${side}/changed.txt lists ${name}, but ${pair.after} is missing`);
      changed.push(`${side}/${name}`);
    }
  }
  return { dir, changed };
}

// The frames the gate run that passed on sha uploaded, unpacked into dir; null when that run uploaded
// no design-frames (a change that touched no render path). Throws when there is no passing gate run
// on the sha, and FramesError when the artifact is expired or malformed.
export async function fetchFrames(opts: GitHubOptions, sha: string, dir: string): Promise<Frames | null> {
  const run = await gateRunForSha(opts, sha);
  if (!run) throw new FramesError(`no passing gate run on ${sha.slice(0, 8)} to read frames from`);
  const artifact = (await listRunArtifacts(opts, run.id)).find((candidate) => candidate.name === FRAMES_ARTIFACT);
  if (!artifact) return null;
  if (artifact.expired) throw new FramesError(`the ${FRAMES_ARTIFACT} artifact of gate run ${run.id} has expired`);
  const zip = await downloadArtifact(opts, artifact.id, FRAMES_ZIP_MAX_BYTES);
  return unpackFrames(zip, dir);
}
