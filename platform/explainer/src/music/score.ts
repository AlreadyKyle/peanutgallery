import * as Tone from 'tone';
import { BAR, CHOREO, DURATION, FPS, sceneBar, TOTAL_BARS, type SceneId } from '../timeline';

// The soundtrack, made in code (docs/specs/explainer-video.md): a warm D major groove at the video's
// 120 BPM, with every sound the picture makes (a card dealt, a coin landing, a flip, the stamp)
// scheduled from the same CHOREO table the scenes read, so each lands on its frame. scripts/music.mjs
// renders it offline in headless Chromium; nothing is recorded, sampled or downloaded.

const SPB = BAR / FPS; // seconds per bar
const LENGTH = DURATION / FPS;
/** Seconds from the start of the video to `barsIn` bars into `scene`. */
const at = (scene: SceneId, barsIn: number) => (sceneBar(scene) + barsIn) * SPB;
const bar = (n: number) => n * SPB;
const FALL = 18 / FPS; // a coin's fall in Fills

type Chord = { root: string; pad: string[]; arp: string[] };
// Dmaj9, Bm7, Gmaj7, A: one chord a bar, round and round from the first bar to the last.
const CHORDS: Chord[] = [
  { root: 'D2', pad: ['F#3', 'A3', 'C#4', 'E4'], arp: ['D5', 'F#5', 'A5', 'C#6', 'E6', 'C#6', 'A5', 'F#5'] },
  { root: 'B1', pad: ['F#3', 'A3', 'B3', 'D4'], arp: ['B4', 'D5', 'F#5', 'A5', 'B5', 'A5', 'F#5', 'D5'] },
  { root: 'G1', pad: ['F#3', 'G3', 'B3', 'D4'], arp: ['G4', 'B4', 'D5', 'F#5', 'G5', 'F#5', 'D5', 'B4'] },
  { root: 'A1', pad: ['E3', 'A3', 'C#4', 'E4'], arp: ['A4', 'C#5', 'E5', 'A5', 'C#6', 'A5', 'E5', 'C#5'] },
];
const chord = (n: number) => CHORDS[Math.floor(n) % 4]!;

// The hook, four bars in D major, as [beat, note, beats long].
const HOOK: [number, string, number][] = [
  [0, 'A5', 1], [1, 'F#5', 0.5], [1.5, 'A5', 0.5], [2, 'B5', 1], [3, 'A5', 1],
  [4, 'F#5', 2], [6, 'E5', 1], [7, 'D5', 1],
  [8, 'D5', 0.5], [8.5, 'E5', 0.5], [9, 'F#5', 1], [10, 'A5', 1], [11, 'B5', 1],
  [12, 'C#6', 1.5], [13.5, 'B5', 0.5], [14, 'A5', 2],
];

// Where the music is: bars from the start of the video.
const S = {
  groove: sceneBar('intro') + 3,
  team: sceneBar('team'),
  pick: sceneBar('pick'),
  build: sceneBar('build'),
  checks: sceneBar('checks'),
  shipped: sceneBar('shipped'),
  ledger: sceneBar('ledger'),
  outro: sceneBar('outro'),
  end: TOTAL_BARS,
};

export async function render(): Promise<Tone.ToneAudioBuffer> {
  return Tone.Offline(async () => {
    // ---- The desk ------------------------------------------------------------------------------
    const limiter = new Tone.Limiter(-1).toDestination();
    const comp = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.01, release: 0.2 }).connect(limiter);
    const bus = new Tone.Gain(0.9).connect(comp);
    const verb = new Tone.Reverb({ decay: 3.2, preDelay: 0.02, wet: 1 });
    await verb.ready;
    verb.connect(bus);
    const route = <T extends Tone.ToneAudioNode>(node: T, send = 0.15): T => {
      node.connect(bus);
      const g = new Tone.Gain(send).connect(verb);
      node.connect(g);
      return node;
    };

    // ---- The band ------------------------------------------------------------------------------
    const padFilter = new Tone.Filter(900, 'lowpass', -24);
    const padLow = new Tone.Filter(160, 'highpass');
    padLow.connect(padFilter);
    const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.6, wet: 0.5 }).start();
    padFilter.connect(chorus);
    route(chorus, 0.35);
    const pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
      envelope: { attack: 0.9, decay: 0.4, sustain: 0.85, release: 2.4 },
      volume: -24,
    }).connect(padLow);

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

    const lead = route(
      new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2,
        modulationIndex: 4,
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.5, sustain: 0.25, release: 0.4 },
        modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0.1, release: 0.3 },
        volume: -19,
      }),
      0.25,
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
    const arp = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.11, sustain: 0, release: 0.05 }, volume: -30 }).connect(arpFilter);

    const kick = route(new Tone.MembraneSynth({ pitchDecay: 0.032, octaves: 6, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 }, volume: -10 }), 0);
    const clapFilter = new Tone.Filter(1700, 'bandpass', -12);
    route(clapFilter, 0.3);
    const clap = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -15 }).connect(clapFilter);
    const hatFilter = new Tone.Filter(8000, 'highpass');
    route(hatFilter, 0.05);
    const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 }, volume: -27 }).connect(hatFilter);

    // ---- The sounds the picture makes ------------------------------------------------------------
    const flickFilter = new Tone.Filter(3200, 'highpass');
    route(flickFilter, 0.1);
    const flick = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.06, sustain: 0 }, volume: -12 }).connect(flickFilter);
    const whooshFilter = new Tone.Filter(600, 'bandpass', -12);
    whooshFilter.Q.value = 1.2;
    route(whooshFilter, 0.3);
    const whoosh = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.08, decay: 0.3, sustain: 0.2, release: 0.25 }, volume: -12 }).connect(whooshFilter);
    const coin = route(
      new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 4,
        modulationIndex: 6,
        envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.3 },
        modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
        volume: -15,
      }),
      0.25,
    );
    const pop = route(new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 }, volume: -12 }), 0.15);
    const tick = route(new Tone.MembraneSynth({ pitchDecay: 0.006, octaves: 2, envelope: { attack: 0.001, decay: 0.05, sustain: 0 }, volume: -16 }), 0.05);
    const thud = route(new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.001, decay: 0.5, sustain: 0 }, volume: -4 }), 0.1);
    const slapFilter = new Tone.Filter(1200, 'lowpass');
    route(slapFilter, 0.35);
    const slap = new Tone.NoiseSynth({ noise: { type: 'brown' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 }, volume: -2 }).connect(slapFilter);

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
    const hit = (time: number, big = false) => {
      thud.triggerAttackRelease(big ? 'A0' : 'D1', 0.5, time, big ? 1 : 0.8);
      slap.triggerAttackRelease(0.12, time, big ? 1 : 0.6);
    };

    // ---- Harmony and groove, bar by bar -----------------------------------------------------------
    for (let n = 0; n < S.end; n += 1) {
      const c = chord(n);
      const t0 = bar(n);
      const inOutro = n >= S.outro;
      // The pad holds every bar; the checks open its filter bar by bar, the shipped section keeps it open.
      if (n < S.end - 1) pad.triggerAttackRelease(c.pad, SPB * 0.98, t0, n === 0 ? 0.6 : 0.8);
      if (n >= S.checks && n < S.shipped) padFilter.frequency.setValueAtTime(900 + (n - S.checks + 1) * 450, t0);
      if (n === S.shipped) padFilter.frequency.setValueAtTime(2200, t0);
      if (n === S.ledger) padFilter.frequency.setValueAtTime(1300, t0);
      if (n === S.outro) {
        padFilter.frequency.setValueAtTime(1300, t0);
        padFilter.frequency.linearRampToValueAtTime(800, t0 + SPB * 2);
      }

      const grooving = n >= S.groove && !inOutro;
      if (!grooving) continue;
      const full = n >= S.shipped && n < S.ledger;
      const busy = n >= S.build && n < S.shipped;
      for (let beat = 0; beat < 4; beat += 1) {
        const tb = t0 + (beat * SPB) / 4;
        if (full || beat % 2 === 0) kick.triggerAttackRelease('C1', 0.3, tb, beat % 2 === 0 ? 1 : 0.7);
        if (n >= S.pick && beat % 2 === 1) clap.triggerAttackRelease(0.16, tb, 0.8);
        // Hats on the off-beats, sixteenths while the agents work. A mono voice cancels anything
        // scheduled after a new note, so every voice here is scheduled in time order.
        if (busy || full) hat.triggerAttackRelease(0.03, tb + SPB / 16, 0.45);
        hat.triggerAttackRelease(0.03, tb + SPB / 8, 0.9);
        if (busy || full) hat.triggerAttackRelease(0.03, tb + (3 * SPB) / 16, 0.45);
        // Bass: the root on the beat and the octave on the "and".
        bass.triggerAttackRelease(c.root, SPB / 8 - 0.02, tb, 0.9);
        const up = Tone.Frequency(c.root).transpose(12).toNote();
        bass.triggerAttackRelease(beat === 3 ? Tone.Frequency(c.root).transpose(7).toNote() : up, SPB / 8 - 0.02, tb + SPB / 8, 0.6);
      }
      // A little kick-and-clap run into the shipped section.
      if (n === S.shipped - 1) {
        // The groove's own clap is on the twelfth sixteenth; the run adds the three after it.
        for (const s of [13, 14, 15]) clap.triggerAttackRelease(0.1, t0 + (s * SPB) / 16, 0.4 + s * 0.04);
      }
      // The arpeggio from Pick on, in eighths, sixteenths while the agents work.
      if (n >= S.pick) {
        const steps = busy || full ? 16 : 8;
        for (let s = 0; s < steps; s += 1) arp.triggerAttackRelease(c.arp[s % 8]!, 0.08, t0 + (s * SPB) / steps, busy || full ? 0.75 : 0.6);
      }
    }

    // The hook: over the shipped section, and softly again on the closing plate.
    const playHook = (from: number, synth: Tone.PolySynth<Tone.FMSynth>, velocity: number) => {
      for (const [beat, note, beats] of HOOK) synth.triggerAttackRelease(note, (beats * SPB) / 4, bar(from) + (beat * SPB) / 4, velocity);
    };
    playHook(S.shipped, lead, 0.9);
    playHook(S.outro, bell, 0.4);

    // ---- The opening: the mark builds up note by note ---------------------------------------------
    const intro = CHOREO.intro;
    bell.triggerAttackRelease('D4', 1.5, at('intro', intro.cabinet), 0.7);
    bell.triggerAttackRelease('A4', 1.2, at('intro', intro.screen), 0.7);
    bell.triggerAttackRelease('D5', 0.8, at('intro', intro.eyes[0]), 0.8);
    bell.triggerAttackRelease('F#5', 0.8, at('intro', intro.eyes[1]), 0.8);
    bell.triggerAttackRelease('A5', 0.8, at('intro', intro.slot), 0.8);
    for (const d of [0, 22, 46]) tick.triggerAttackRelease('G5', 0.04, at('intro', intro.glance) + d / FPS, 0.5);
    bell.triggerAttackRelease(['D6', 'F#6', 'A6'], 1.4, at('intro', intro.word), 0.45);
    bloop(at('intro', intro.blink), 'A5', 0.7);
    sweep(at('intro', intro.collapse), 0.9, 300, 2600);
    sweep(at('intro', intro.phone), 0.6, 500, 1800);
    bloop(at('intro', intro.tag), 'D5');
    sweep(at('intro', intro.exit), 0.6, 1800, 400);

    // ---- The team pops up, one agent an eighth ------------------------------------------------------
    const pent = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6', 'A6'];
    CHOREO.team.pops.forEach((b, i) => bloop(at('team', b), pent[i]!));
    CHOREO.team.blinks.forEach((b) => bloop(at('team', b), 'A6', 0.8));
    sweep(at('team', CHOREO.team.exit), 0.5, 1800, 400);

    // ---- Pick: five cards dealt, one lifted ----------------------------------------------------------
    CHOREO.pick.deal.forEach((b) => flick.triggerAttackRelease(0.06, at('pick', b)));
    sweep(at('pick', CHOREO.pick.lift), 0.5, 400, 2400);
    bell.triggerAttackRelease(['A5', 'D6'], 0.8, at('pick', CHOREO.pick.target), 0.5);
    sweep(at('pick', CHOREO.pick.exit), 0.4, 1600, 500);

    // ---- Split: the coin lands, the handle clicks along, the coin parts ----------------------------------
    const sp = CHOREO.split;
    coin.triggerAttackRelease(['B5', 'E6'], 0.4, at('split', sp.coin) + 0.18, 0.9);
    coin.triggerAttackRelease('E6', 0.25, at('split', sp.coin) + 0.34, 0.4);
    sp.handle.forEach((b, i) => tick.triggerAttackRelease(i % 2 === 0 ? 'E5' : 'A5', 0.05, at('split', b)));
    sweep(at('split', sp.part), 0.5, 900, 2800);
    coin.triggerAttackRelease(['A5', 'D6'], 0.4, at('split', sp.land), 0.8);

    // ---- Fills: four coins, each a step higher, then the flip to Funded ------------------------------------
    const coinNotes: [string, string][] = [['A5', 'D6'], ['B5', 'E6'], ['C#6', 'F#6'], ['D6', 'A6']];
    CHOREO.fills.coins.forEach((b, i) => coin.triggerAttackRelease(coinNotes[i]!, 0.4, at('fills', b) + FALL, 0.9));
    sweep(at('fills', CHOREO.fills.flip), 0.35, 700, 3000);
    bell.triggerAttackRelease(['D5', 'F#5', 'A5', 'D6'], 1.2, at('fills', CHOREO.fills.flip) + 0.2, 0.6);
    sweep(at('fills', CHOREO.fills.queue), 0.6, 1200, 500);

    // ---- Build: the builder hops in, the card flips, each step ticks ------------------------------------
    for (const d of [0, 0.22, 0.44]) bloop(at('build', CHOREO.build.agent) + d, 'F#5', 1.3);
    sweep(at('build', CHOREO.build.flip), 0.35, 700, 3000);
    CHOREO.build.events.forEach((b, i) => {
      tick.triggerAttackRelease('C6', 0.04, at('build', b), 0.8);
      tick.triggerAttackRelease('G5', 0.04, at('build', b) + 0.06, 0.5);
      if (i === CHOREO.build.events.length - 1) bell.triggerAttackRelease('A5', 0.6, at('build', b), 0.5);
    });

    // ---- Checks: the flip, the phone, the play bot's taps, two passes -------------------------------------
    const ch = CHOREO.checks;
    for (const d of [0, 0.22, 0.44]) bloop(at('checks', ch.flip) + d, 'F#5', 1.3);
    sweep(at('checks', ch.flip), 0.35, 700, 3000);
    sweep(at('checks', ch.phone), 0.6, 500, 1800);
    ch.taps.forEach((b) => tick.triggerAttackRelease('A4', 0.05, at('checks', b), 0.9));
    bell.triggerAttackRelease(['A5', 'E6'], 0.8, at('checks', ch.passed[0]), 0.7);
    bell.triggerAttackRelease(['D6', 'F#6', 'A6'], 1.2, at('checks', ch.passed[1]), 0.8);
    sweep(at('checks', ch.exit), 0.5, 1800, 400);

    // ---- Shipped: the flip, the stamp, the pile, the slam ----------------------------------------------------
    const sh = CHOREO.shipped;
    sweep(at('shipped', sh.flip), 0.35, 700, 3000);
    hit(at('shipped', sh.stamp) + 0.06);
    [0, 15, 30].forEach((d) => hit(at('shipped', sh.pile) + (d + 10) / FPS));
    hit(at('shipped', sh.slam), true);
    sweep(at('shipped', sh.exit), 0.5, 1800, 400);

    // ---- The ledger: each row a soft coin -------------------------------------------------------------------
    CHOREO.ledger.rows.forEach((b, i) => coin.triggerAttackRelease(pent[i + 1]!, 0.3, at('ledger', b), 0.45));
    sweep(at('ledger', CHOREO.ledger.exit), 0.5, 1600, 400);

    // ---- The close: the plate unfolds, the wordmark rings, a last blink, the chord rings out ---------------
    const o = CHOREO.outro;
    sweep(at('outro', o.expand), 0.9, 2600, 300);
    // The closing line: a rising chord on each of its three sentences, the address a soft blip.
    const closing: string[][] = [['D5', 'A5'], ['E5', 'B5'], ['F#5', 'D6', 'A6']];
    o.lines.forEach((b, i) => {
      tick.triggerAttackRelease('C6', 0.04, at('outro', b), 0.7);
      bell.triggerAttackRelease(closing[i]!, 1.2, at('outro', b), 0.55 + i * 0.1);
    });
    bloop(at('outro', o.url), 'D6', 1.2);
    bloop(at('outro', o.blink), 'A5', 0.7);
    pad.triggerAttackRelease(['D3', 'F#3', 'A3', 'E4'], LENGTH - bar(S.end - 1), bar(S.end - 1), 0.7);
    bell.triggerAttackRelease(['D4', 'A4', 'F#5'], 3, bar(S.end - 1), 0.5);
  }, LENGTH, 2, 48000);
}
