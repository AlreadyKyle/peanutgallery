// Moments to drafts: one draft per moment per channel, in the studio's voice (docs/BRAND.md and
// docs/COPY.md in the studio repository). Each kind has a few variants; the playbook picks which
// one to try, so the machine learns which framing works on which channel.
import { LIMITS, money, slug } from './lib.mjs';
import { clipProps, clipTitle } from './clips.mjs';
import { chooseVariant } from './learn.mjs';
import { lintText } from './lint.mjs';

export { LIMITS };
// X counts any link as 23 characters.
const X_LINK = 23;

const where = (f) => (f.game ? f.game : f.suit === 'platform' ? 'the studio' : 'the site');
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const sentence = (s) => (!s ? '' : /[.?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export const TEMPLATES = {
  ship: {
    plain: (f) => `New in ${where(f)}: ${sentence(f.summary ?? f.title)}`,
    agent: (f) => (f.role ? `${f.role}, one of our AI agents, shipped a change to ${where(f)}. ${sentence(f.summary ?? f.title)}` : null),
    cost: (f) => (f.spentUsd > 0 ? `An AI agent changed ${where(f)} for ${money(f.spentUsd)} of agent work, paid from contributions. ${sentence(f.summary ?? f.title)}` : null),
    invite: (f) => (f.game ? `${sentence(f.summary ?? f.title)} It is live in ${f.game} now, free in your browser, and the card shows how the agents built it.` : null),
  },
  spotlight: {
    plain: (f) => `Open for funding: ${sentence(f.title)} ${sentence(f.summary)} ${money(f.fundedUsd)} of ${money(f.targetUsd)} so far.`,
    next: (f) => `When this card is funded, an AI agent builds it and automated checks decide if it ships: ${sentence(f.title)}`,
  },
  weekly_report: {
    plain: (f) => `The week of ${f.weekLabel} at Mob Machine: ${f.count} ${f.count === 1 ? 'change' : 'changes'} shipped${f.shipped[0] ? `, including "${f.shipped[0]}"` : ''}. The report lists each one with its cost.`,
  },
  card_legendary: { plain: (f) => `A legendary card just opened. ${sentence(f.text)}` },
  card_rare: { plain: (f) => `A rare card just opened. ${sentence(f.text)}` },
  milestone: { plain: (f) => sentence(f.text) },
  era: { plain: (f) => `The studio grew. ${sentence(f.text)}` },
  stage: { plain: (f) => sentence(f.text) },
  seed_featured: { plain: (f) => `A run worth trying, picked from the seeds players shared. ${sentence(f.text)}` },
  suggestion_live: { plain: (f) => `Someone suggested this, and the agents built it. ${sentence(f.text)}` },
  explainer: { plain: (f) => f.text },
  play_dust: {
    plain: (f) => `Dust is a free browser game that AI agents keep changing. ${f.shipped} changes have shipped so far, each one funded and checked in public.`,
    invite: () => 'Dust runs in your browser and starts in seconds. AI agents change it each time someone funds a card.',
  },
  daily_dust: { plain: (f) => `Today's Dust run is the same seed for everyone. ${sentence(f.text ?? '')}`.trim() },
};

export function linkFor(moment, channelTag, config) {
  const f = moment.facts;
  const base = f.url ?? `${config.site}${f.path ?? '/'}`;
  return `${base}${base.includes('?') ? '&' : '?'}from=${channelTag}`;
}

function fits(text, link, channel) {
  const limit = LIMITS[channel] ?? 500;
  const linkLength = channel === 'x' ? X_LINK : link.length;
  return text.length + 2 + linkLength <= limit;
}

function shorten(text, link, channel) {
  const limit = LIMITS[channel] ?? 500;
  const linkLength = channel === 'x' ? X_LINK : link.length;
  const room = limit - 2 - linkLength;
  if (text.length <= room) return text;
  const sentences = text.match(/[^.?]+[.?]/g) ?? [text];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > room) break;
    out += s;
  }
  return out.trim() || text.slice(0, room - 1).replace(/\s+\S*$/, '') + '.';
}

export function composeDrafts(moments, config, playbook, existingIds, now = new Date()) {
  const drafts = [];
  for (const moment of moments) {
    const variants = TEMPLATES[moment.kind];
    if (!variants) continue;
    if (moment.kind === 'weekly_report') {
      moment.facts.weekLabel = new Date(`${moment.facts.weekStart}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    }
    const clip = moment.facts.video ? null : clipProps(moment);
    for (const [channel, ch] of Object.entries(config.channels)) {
      if (!ch.enabled) continue;
      const hasVideo = Boolean(moment.facts.video || clip);
      if ((ch.videoOnly && !hasVideo) || (ch.mediaOnly && !hasVideo && !moment.facts.image)) continue;
      // Only the video channels get the clip; the others keep the card's preview image.
      const useClip = Boolean(clip && (ch.videoOnly || ch.mediaOnly));
      // The daily spotlight repeats a card for days; a clip of it goes out once per card.
      const ref = useClip && moment.kind === 'spotlight' ? moment.facts.id : moment.ref;
      const id = `${slug(moment.kind, 16)}-${slug(ref, 24)}-${channel}`;
      if (existingIds.has(id)) continue;
      const usable = Object.entries(variants)
        .map(([name, fn]) => [name, fn(moment.facts)])
        .filter(([, text]) => text);
      if (usable.length === 0) continue;
      const variant = chooseVariant(playbook, moment.kind, channel, usable.map(([name]) => name));
      const link = linkFor(moment, ch.tag ?? channel, config);
      const raw = usable.find(([name]) => name === variant)[1];
      const text = fits(raw, link, channel) ? raw : shorten(raw, link, channel);
      const problems = lintText(text, { channel, link });
      drafts.push({
        id,
        createdAt: now.toISOString(),
        status: problems.length ? 'needs_edit' : 'pending',
        problems,
        moment: { kind: moment.kind, ref: moment.ref, priority: moment.priority, at: moment.at },
        channel,
        variant,
        text,
        link,
        image: moment.facts.image ? `${config.site}${moment.facts.image}` : null,
        video: moment.facts.video ?? null,
        ...(useClip ? { clip, title: clipTitle(moment) } : {}),
      });
    }
  }
  return drafts;
}
