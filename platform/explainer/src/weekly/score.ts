import * as Tone from 'tone';
import { BAR, FPS } from '../timeline';
import { CLOSE, layout, PLATE, ringStart, segmentShown, WIPE_AT } from './layout';
import type { WeekProps } from './schema';

// The weekly video's soundtrack, the explainer's band and key (D major, 120 BPM, the same four
// chords) laid on the week's own timeline from layout.ts, so each sound lands on its frame: the mark
// building up, a soft flick as each capture comes in, a whoosh across each wipe, a rising note as each segment starts, a tick as
// each ring draws, and the closing chords. scripts/music.mjs renders it offline with --weekly <date>.

type Chord = { root: string; pad: string[]; arp: string[] };
const CHORDS: Chord[] = [
  { root: 'D2', pad: ['F#3', 'A3', 'C#4', 'E4'], arp: ['D5', 'F#5', 'A5', 'C#6', 'E6', 'C#6', 'A5', 'F#5'] },
  { root: 'B1', pad: ['F#3', 'A3', 'B3', 'D4'], arp: ['B4', 'D5', 'F#5', 'A5', 'B5', 'A5', 'F#5', 'D5'] },
  { root: 'G1', pad: ['F#3', 'G3', 'B3', 'D4'], arp: ['G4', 'B4', 'D5', 'F#5', 'G5', 'F#5', 'D5', 'B4'] },
  { root: 'A1', pad: ['E3', 'A3', 'C#4', 'E4'], arp: ['A4', 'C#5', 'E5', 'A5', 'C#6', 'A5', 'E5', 'C#5'] },
];
const PENT = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6', 'A6'];

export async function render(week: WeekProps): Promise<Tone.ToneAudioBuffer> {
  const plan = layout(week);
  const SPB = BAR / FPS;
  const LENGTH = plan.duration / FPS;
  const sec = (frame: number) => frame / FPS;
  const bar = (n: number) => n * SPB;
  const totalBars = Math.ceil(plan.bars);
  const barOf = (frame: number) => frame / BAR;
  const firstSeg = barOf(plan.segments[0]!.start);
  const outroBar = barOf(plan.outro);
  const listSeg = week.segments.findIndex((s) => s.kind === 'list');
  const listFrom = listSeg === -1 ? Infinity : barOf(plan.segments[listSeg]!.start);

  return Tone.Offline(async () => {
    const limiter = new Tone.Limiter(-1).toDestination();
    const comp = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.01, release: 0.2 }).connect(limiter);
    const bus = new Tone.Gain(0.9).connect(comp);
    const verb = new Tone.Reverb({ decay: 3.2, preDelay: 0.02, wet: 1 });
    await verb.ready;
    verb.connect(bus);
    const route = <T extends Tone.ToneAudioNode>(node: T, send = 0.15): T => {
      node.connect(bus);
      node.connect(new Tone.Gain(send).connect(verb));
      return node;
    };

    const padFilter = new Tone.Filter(900, 'lowpass', -24);
    const padLow = new Tone.Filter(160, 'highpass');
    padLow.connect(padFilter);
    const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.6, wet: 0.5 }).start();
    padFilter.connect(chorus);
    route(chorus, 0.35);
    const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 18 }, envelope: { attack: 0.9, decay: 0.4, sustain: 0.85, release: 2.4 }, volume: -24 }).connect(padLow);
    const bell = route(
      new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 12,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.9 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
        volume: -17,
      }),
      0.3,
    );
    const bass = route(
      new Tone.MonoSynth({
        oscillator: { type: 'square' },
        filter: { Q: 1.5, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.004, decay: 0.16, sustain: 0.25, release: 0.1, baseFrequency: 90, octaves: 2.8 },
        envelope: { attack: 0.004, decay: 0.2, sustain: 0.55, release: 0.08 },
        volume: -19,
      }),
      0,
    );
    const arpFilter = new Tone.Filter(2600, 'lowpass');
    route(arpFilter, 0.25);
    const arp = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.11, sustain: 0, release: 0.05 }, volume: -31 }).connect(arpFilter);
    const kick = route(new Tone.MembraneSynth({ pitchDecay: 0.032, octaves: 6, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 }, volume: -11 }), 0);
    const clapFilter = new Tone.Filter(1700, 'bandpass', -12);
    route(clapFilter, 0.3);
    const clap = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -16 }).connect(clapFilter);
    const hatFilter = new Tone.Filter(8000, 'highpass');
    route(hatFilter, 0.05);
    const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 }, volume: -28 }).connect(hatFilter);

    const flickFilter = new Tone.Filter(3200, 'highpass');
    route(flickFilter, 0.1);
    const flick = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.06, sustain: 0 }, volume: -16 }).connect(flickFilter);
    const whooshFilter = new Tone.Filter(600, 'bandpass', -12);
    whooshFilter.Q.value = 1.2;
    route(whooshFilter, 0.3);
    const whoosh = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.08, decay: 0.3, sustain: 0.2, release: 0.25 }, volume: -13 }).connect(whooshFilter);
    const pop = route(new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 }, volume: -13 }), 0.15);
    const tick = route(new Tone.MembraneSynth({ pitchDecay: 0.006, octaves: 2, envelope: { attack: 0.001, decay: 0.05, sustain: 0 }, volume: -17 }), 0.05);

    const sweep = (time: number, length: number, from: number, to: number) => {
      whoosh.triggerAttackRelease(length, time);
      whooshFilter.frequency.setValueAtTime(from, time);
      whooshFilter.frequency.exponentialRampToValueAtTime(to, time + length);
    };
    const bloop = (time: number, note: string, up = 1.6) => {
      pop.triggerAttackRelease(note, 0.12, time);
      const f = Tone.Frequency(note).toFrequency();
      pop.frequency.setValueAtTime(f, time);
      pop.frequency.exponentialRampToValueAtTime(f * up, time + 0.07);
    };

    // Harmony and groove, bar by bar: the pad from the first bar, the groove once the first segment
    // starts, claps and the arpeggio from the second, busier hats through the quick list.
    for (let n = 0; n < totalBars; n += 1) {
      const c = CHORDS[n % 4]!;
      const t0 = bar(n);
      if (n < totalBars - 1) pad.triggerAttackRelease(c.pad, SPB * 0.98, t0, n === 0 ? 0.6 : 0.8);
      if (n < PLATE.content || n >= outroBar) continue;
      const grooving = n >= Math.floor(firstSeg);
      const busy = n >= Math.floor(listFrom);
      for (let beat = 0; beat < 4; beat += 1) {
        const tb = t0 + (beat * SPB) / 4;
        if (grooving && beat % 2 === 0) kick.triggerAttackRelease('C1', 0.3, tb, 1);
        if (grooving && n >= firstSeg + 2 && beat % 2 === 1) clap.triggerAttackRelease(0.16, tb, 0.7);
        if (busy) hat.triggerAttackRelease(0.03, tb + SPB / 16, 0.4);
        hat.triggerAttackRelease(0.03, tb + SPB / 8, grooving ? 0.85 : 0.5);
        if (grooving) {
          bass.triggerAttackRelease(c.root, SPB / 8 - 0.02, tb, 0.9);
          const up = Tone.Frequency(c.root).transpose(12).toNote();
          bass.triggerAttackRelease(beat === 3 ? Tone.Frequency(c.root).transpose(7).toNote() : up, SPB / 8 - 0.02, tb + SPB / 8, 0.6);
        }
      }
      if (n >= firstSeg + 2) for (let s = 0; s < 8; s += 1) arp.triggerAttackRelease(c.arp[s]!, 0.08, t0 + (s * SPB) / 8, 0.55);
    }

    // The plate: the mark builds up note by note, then folds away.
    bell.triggerAttackRelease('D4', 1.5, bar(PLATE.cabinet), 0.7);
    bell.triggerAttackRelease('A4', 1.2, bar(PLATE.screen), 0.7);
    bell.triggerAttackRelease('D5', 0.8, bar(PLATE.eyes[0]), 0.8);
    bell.triggerAttackRelease('F#5', 0.8, bar(PLATE.eyes[1]), 0.8);
    bell.triggerAttackRelease('A5', 0.8, bar(PLATE.slot), 0.8);
    bell.triggerAttackRelease(['D6', 'F#6', 'A6'], 1.4, bar(PLATE.word), 0.45);
    bloop(bar(PLATE.blink), 'A5', 0.7);
    sweep(bar(PLATE.collapse), 0.9, 300, 2600);

    // Each wipe: a whoosh up as the bands cross, and one down as they leave.
    plan.wipes.forEach((w) => {
      const from = w.start - WIPE_AT.lead;
      sweep(sec(from), sec(WIPE_AT.band + WIPE_AT.stagger * 2), 400, 3200);
      sweep(sec(from + WIPE_AT.out), sec(WIPE_AT.band + WIPE_AT.stagger * 2), 3200, 400);
    });

    // Each segment: a rising note a step higher than the last, as its number lands. Each beat: a flick as its capture
    // comes in. Each ring: a tick and a soft bell.
    plan.segments.forEach((_, i) => bloop(sec(segmentShown(plan, i)), PENT[i % PENT.length]!));
    plan.beats.forEach((placed, i) => {
      if (i > 0 && placed.index > 0) flick.triggerAttackRelease(0.06, sec(placed.start), 0.7);
      if (placed.beat.ring !== undefined) {
        const t = sec(placed.start + ringStart(plan, i));
        tick.triggerAttackRelease('C6', 0.04, t, 0.7);
        bell.triggerAttackRelease('A5', 0.5, t, 0.3);
      }
    });

    // The close: the plate unfolds, a chord on each line, the address a soft blip, the chord rings out.
    const o = sec(plan.outro);
    sweep(o, 0.9, 2600, 300);
    const closing: string[][] = [['D5', 'A5'], ['E5', 'B5'], ['F#5', 'D6', 'A6'], ['A5', 'D6']];
    week.outro.lines.forEach((_, i) => {
      const t = o + bar(CLOSE.lines[i] ?? CLOSE.lines[CLOSE.lines.length - 1]!);
      tick.triggerAttackRelease('C6', 0.04, t, 0.7);
      bell.triggerAttackRelease(closing[i % closing.length]!, 1.2, t, 0.55 + i * 0.1);
    });
    bloop(o + bar(CLOSE.address), 'D6', 1.2);
    const last = bar(totalBars - 1);
    pad.triggerAttackRelease(['D3', 'F#3', 'A3', 'E4'], Math.max(0.5, LENGTH - last), last, 0.7);
    bell.triggerAttackRelease(['D4', 'A4', 'F#5'], 3, last, 0.5);
  }, LENGTH, 2, 48000);
}
