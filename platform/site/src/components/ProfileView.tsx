import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { Profile, Suit } from '../lib/community-types';
import { copy } from '../lib/copy';
import { formatDate, formatInteger } from '../lib/format';
import { relativeTime } from '../lib/community';
import { RARITY_ORDER, SUIT_ORDER } from '../lib/suits';
import { xpForLevel } from '../lib/xp';
import { SeedTile } from '../pages/Seeds';
import { Glyph, RarityTag, SUITS, SuitTag } from './Glyph';
import { PersonAvatar } from './Person';

// A player's public profile (docs/specs/final-state.md, XP, levels, badges, avatars, frames): the
// avatar in its frame, the level, the tier and the XP bar, the flair, the badges with their rules, the
// cards they helped fund grouped by suit with each card's rarity, their seeds and their suggestions.
// XP is a record of participation and never money, so its bar is ink, never the coin.

export function XpBar({ profile }: { profile: Profile }) {
  const floor = xpForLevel(profile.level);
  const span = Math.max(1, profile.nextLevelXp - floor);
  const share = Math.max(0, Math.min(1, (profile.xp - floor) / span));
  return (
    <div className="xp">
      <p className="xp-line">
        <span className="xp-level">{copy.profile.level.replace('{n}', String(profile.level))}</span>
        <span className="xp-tier">{profile.tier}</span>
        <span className="xp-figure">{copy.profile.xp.replace('{n}', formatInteger(profile.xp))}</span>
      </p>
      <div
        className="xp-bar"
        role="progressbar"
        aria-label={copy.profile.xpBar}
        aria-valuemin={floor}
        aria-valuemax={profile.nextLevelXp}
        aria-valuenow={profile.xp}
        aria-valuetext={copy.profile.xpToNext.replace('{n}', formatInteger(Math.max(0, profile.nextLevelXp - profile.xp))).replace('{level}', String(profile.level + 1))}
      >
        <div className="xp-bar-fill" style={{ '--fill': `${(share * 100).toFixed(1)}%` } as CSSProperties} />
      </div>
      <p className="small muted">{copy.profile.xpToNext.replace('{n}', formatInteger(Math.max(0, profile.nextLevelXp - profile.xp))).replace('{level}', String(profile.level + 1))}</p>
    </div>
  );
}

export function ProfileHead({ profile }: { profile: Profile }) {
  return (
    <div className="profile-head">
      <PersonAvatar person={profile} size={112} />
      <div className="profile-id">
        {profile.flair === null ? null : <p className="flair">{profile.flair}</p>}
        <p className="small muted">
          {copy.profile.frame.replace('{frame}', profile.frame ?? copy.profile.noFrame)} · {copy.profile.joined.replace('{date}', formatDate(profile.joinedAt))}
        </p>
        <XpBar profile={profile} />
      </div>
    </div>
  );
}

export function ProfileView({ profile }: { profile: Profile }) {
  const bySuit = SUIT_ORDER.map((suit) => [suit, profile.collection.filter((card) => card.suit === suit)] as const).filter(([, cards]) => cards.length > 0);
  const rank = (r: string) => RARITY_ORDER.indexOf(r as (typeof RARITY_ORDER)[number]);
  return (
    <>
      <section className="section" aria-labelledby="profile-who">
        <h2 id="profile-who" className="sr-only">
          {copy.profile.whoTitle}
        </h2>
        <ProfileHead profile={profile} />
      </section>
      <section className="section" aria-labelledby="profile-badges">
        <h2 id="profile-badges">{copy.profile.badgesTitle}</h2>
        {profile.badges.length === 0 ? (
          <p className="muted">{copy.profile.noBadges}</p>
        ) : (
          <ul className="badge-grid">
            {profile.badges.map((badge) => (
              <li key={badge.id} className="badge-tile">
                <span className="badge-medal" aria-hidden="true">
                  <Glyph name="badge" />
                </span>
                <span className="badge-name">{badge.name}</span>
                <span className="small muted">{badge.rule}</span>
                <span className="small muted">{copy.profile.earned.replace('{date}', formatDate(badge.awardedAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section" aria-labelledby="profile-collection">
        <h2 id="profile-collection">{copy.profile.collectionTitle}</h2>
        {bySuit.length === 0 ? (
          <p className="muted">{copy.profile.noCards}</p>
        ) : (
          bySuit.map(([suit, cards]: readonly [Suit, typeof profile.collection]) => (
            <div key={suit} className="collection-suit">
              <h3>
                <SuitTag suit={suit} />
                <span className="muted small"> {cards.length}</span>
              </h3>
              <ul className="collection-grid">
                {[...cards]
                  .sort((a, b) => rank(b.rarity) - rank(a.rarity))
                  .map((card) => (
                    <li key={card.cardId} className="collected" data-rarity={card.rarity}>
                      <span className="rarity-edge" aria-hidden="true" />
                      <RarityTag rarity={card.rarity} />
                      <Link to={`/card/${card.cardId}`} className="collected-title">
                        {card.title}
                      </Link>
                      <span className="small muted">{SUITS[card.suit].label}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </section>
      <section className="section" aria-labelledby="profile-seeds">
        <h2 id="profile-seeds">{copy.profile.seedsTitle}</h2>
        {profile.seeds.length === 0 ? (
          <p className="muted">{copy.profile.noSeeds}</p>
        ) : (
          <ul className="seed-grid">
            {profile.seeds.map((seed) => (
              <SeedTile key={seed.id} seed={seed} signedIn={false} />
            ))}
          </ul>
        )}
      </section>
      <section className="section" aria-labelledby="profile-suggestions">
        <h2 id="profile-suggestions">{copy.profile.suggestionsTitle}</h2>
        {profile.suggestions.length === 0 ? (
          <p className="muted">{copy.profile.noSuggestions}</p>
        ) : (
          <ul className="rows">
            {profile.suggestions.map((item) => (
              <li key={item.id}>
                <p className="row-title">{item.title}</p>
                <p className="row-meta small muted">
                  <span>{copy.suggest.states[item.state]}</span> · <span>{relativeTime(item.createdAt)}</span>
                  {item.cardId === null ? null : (
                    <>
                      {' '}
                      · <Link to={`/card/${item.cardId}`}>{copy.suggest.seeCard}</Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
