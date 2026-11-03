import * as Tone from 'tone';

// The clip's soundtrack, the weekly video's D major groove at 120 BPM (one bar is two seconds) cut
// to 15 seconds, with a sound on each frame the picture lands: the mark, the wipes, the avatar, the
// card, the Live stamp and the outro. Frame numbers match Moment.tsx.
const FPS = 30;
const SPB = 2;
const LENGTH = 15;
const BARS = 8;
const at = (frame: number) => frame / FPS;
const CHORDS = [
  { root: 'D2', pad: ['F#3', 'A3', 'C#4', 'E4'], arp: ['D5', 'F#5', 'A5', 'C#6', 'E6', 'C#6', 'A5', 'F#5'] },
  { root: 'B1', pad: ['F#3', 'A3', 'B3', 'D4'], arp: ['B4', 'D5', 'F#5', 'A5', 'B5', 'A5', 'F#5', 'D5'] },
  { root: 'G1', pad: ['F#3', 'G3', 'B3', 'D4'], arp: ['G4', 'B4', 'D5', 'F#5', 'G5', 'F#5', 'D5', 'B4'] },
  { root: 'A1', pad: ['E3', 'A3', 'C#4', 'E4'], arp: ['A4', 'C#5', 'E5', 'A5', 'C#6', 'A5', 'E5', 'C#5'] },
];

export async function render() {
  return Tone.Offline(({ transport }) => {
    const master = new Tone.Gain(0.8).toDestination();
    const reverb = new Tone.Reverb({ decay: 2.4, wet: 0.25 }).connect(master);
    const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fattriangle', count: 3, spread: 18 }, envelope: { attack: 0.4, decay: 0.3, sustain: 0.7, release: 1.2 }, volume: -22 }).connect(reverb);
    const bass = new Tone.MonoSynth({ oscillator: { type: 'square' }, filter: { Q: 1, type: 'lowpass' }, filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.2, baseFrequency: 120, octaves: 2.5 }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.1 }, volume: -14 }).connect(master);
    const kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.3, sustain: 0 }, volume: -8 }).connect(master);
    const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 }, volume: -30 }).connect(new Tone.Filter(7000, 'highpass').connect(master));
    const clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 }, volume: -22 }).connect(new Tone.Filter(1500, 'bandpass').connect(reverb));
    const arp = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.12, sustain: 0.1, release: 0.2 }, volume: -24 }).connect(reverb);
    const bell = new Tone.FMSynth({ harmonicity: 3.01, modulationIndex: 12, envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1 }, volume: -18 }).connect(reverb);
    const tick = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }, volume: -16 }).connect(reverb);
    const thump = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.001, decay: 0.25, sustain: 0 }, volume: -10 }).connect(reverb);
    const clink = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.35, release: 0.1 }, harmonicity: 5.1, modulationIndex: 16, resonance: 3200, octaves: 1.2, volume: -30 }).connect(reverb);

    for (let b = 0; b < BARS; b += 1) {
      const c = CHORDS[b % 4]!;
      const t0 = b * SPB;
      pad.triggerAttackRelease(c.pad, SPB * 0.95, t0);
      if (b >= 1 && b < BARS - 1) {
        for (let i = 0; i < 8; i += 1) bass.triggerAttackRelease(i % 4 === 3 ? c.root.replace(/\d/, (d) => String(Number(d) + 1)) : c.root, '16n', t0 + (i * SPB) / 8, i % 2 === 0 ? 0.9 : 0.5);
        for (let beat = 0; beat < 4; beat += 1) {
          kick.triggerAttackRelease('C1', '8n', t0 + (beat * SPB) / 4);
          hat.triggerAttackRelease('32n', t0 + ((beat + 0.5) * SPB) / 4, 0.8);
          if (beat % 2 === 1) clap.triggerAttackRelease('16n', t0 + (beat * SPB) / 4);
        }
        if (b >= 2) for (let i = 0; i < 8; i += 1) arp.triggerAttackRelease(c.arp[i]!, '16n', t0 + (i * SPB) / 8, 0.6);
      }
    }

    // The mark, then the wipe to paper and the avatar.
    bell.triggerAttackRelease('A5', '8n', at(4));
    const swellFilter = new Tone.Filter({ type: 'bandpass', frequency: 900, Q: 0.8 }).connect(reverb);
    const swell = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.3, decay: 0.12, sustain: 0, release: 0.15 }, volume: -24 }).connect(swellFilter);
    for (const f of [40, 322]) {
      const t = at(f);
      swell.triggerAttackRelease(0.36, t);
      swellFilter.frequency.setValueAtTime(500, t);
      swellFilter.frequency.exponentialRampToValueAtTime(4500, t + 0.45);
    }
    tick.triggerAttackRelease('D6', '32n', at(78));
    // The card lands, its rows tick in, the stamp hits.
    thump.triggerAttackRelease('D2', '8n', at(176));
    ['F#6', 'A6', 'D7'].forEach((n, i) => tick.triggerAttackRelease(n, '32n', at(206 + i * 10)));
    thump.triggerAttackRelease('G2', '8n', at(254));
    clink.triggerAttackRelease('C6', '16n', at(256));
    // The outro.
    bell.triggerAttackRelease('D6', '8n', at(336));
    master.gain.setValueAtTime(0.8, LENGTH - 2);
    master.gain.linearRampToValueAtTime(0, LENGTH);
    void transport;
  }, LENGTH, 2, 48000);
}
