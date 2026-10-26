import type { GlyphName } from '../../../site/src/components/Glyph';

// The weekly update video's props (docs/specs/weekly-video.md). A week is data only: its segments,
// each a list of beats, and the captures they show. Everything else (type, frames, rings, easing,
// hold times, transitions, the soundtrack) is the template's, so next week's video is a new file in
// weeks/ and a new captures folder, with no change to a component.

/** A rectangle in a capture, as fractions of its frame: x, y, width, height. */
export type Rect = readonly [number, number, number, number];

/** Element rects measured by scripts/weekly-capture.mjs, keyed "<capture>.<name>" (rects.json). */
export type Rects = Record<string, Rect>;

/** The drawn scenes a beat can act out (Scenes.tsx): the explainer's own pieces, moving. */
export type SceneName =
  | 'agents'
  | 'agent-card'
  | 'curator-joins'
  | 'ideas-pitch'
  | 'ideas-vote'
  | 'signup'
  | 'reset'
  | 'follow'
  | 'dust'
  | 'daily'
  | 'seed'
  | 'rates'
  | 'ledger'
  | 'terms'
  | 'checkout'
  | 'shield'
  | 'fast'
  | 'email'
  | 'social';

/** What a beat shows: a drawn scene (the default), a capture of the live site, or a glyph card. */
export type Shot =
  | { scene: SceneName; url?: undefined }
  | {
      /** A file in the week's captures folder: .mp4 plays, .png holds still. */
      src: string;
      /** The address the frame's bar shows. */
      url: string;
      /** For a video: the second of the capture the beat starts on. */
      from?: number;
      /** A label for a capture whose figures can move, such as "As of 20 Oct 2026". */
      asOf?: string;
    }
  | {
      /** No capture: a site card in the frame, its glyph and one plain line. */
      glyph: GlyphName;
      line: string;
      /** The address the frame's bar shows, if the card is about one page. */
      url?: string;
    };

export type Beat = {
  /** One idea, in plain words. A segment's first headline says what changed for a player in under 8 words. */
  headline: string;
  /** At most one supporting line. */
  support?: string;
  shot: Shot;
  /** Push in on this rect ("<capture>.<name>" in rects.json): the main movement of the beat. */
  focus?: string;
  /** How far the push-in goes, when the rect's own fit would crop text beside it (1 to 1.75). */
  zoom?: number;
  /** Ring this rect once the push-in settles, to point at the exact UI the headline names. */
  ring?: string;
  /** Seconds into the beat the ring draws; by default once the push-in has settled. */
  ringAt?: number;
  /** Length in bars (two seconds each); by default from the words (hold times in layout.ts). */
  bars?: number;
};

export type Segment = {
  /** The segment's name, beside its number over the headline. */
  title: string;
  beats: Beat[];
  /** `list` runs its beats at the short hold, for "everything else": headline only, no support. */
  kind?: 'story' | 'list';
};

export type WeekProps = {
  /** The week's last day, ISO (also the captures folder's name). */
  date: string;
  segments: Segment[];
  /** The closing plate: one line a beat, each with its site glyph, then the address. */
  outro: { lines: { glyph: GlyphName; text: string }[]; address: string };
};

/** The composition's input: which week, which cut, and the rects the capture script measured. */
/** The cuts: 16:9, and 9:16 for Reels and TikTok. */
export type WeeklyCut = 'wide' | 'vertical';

export type WeeklyInput = { format: WeeklyCut; week: string; rects?: Rects };

export function isCapture(shot: Shot): shot is Extract<Shot, { src: string }> {
  return 'src' in shot;
}
