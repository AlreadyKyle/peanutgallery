import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  centsFrom,
  clusterOptions,
  COMMUNITY_TABS,
  confirmText,
  DECLINE_REASONS,
  declineSuggestion,
  deleteGoal,
  dollarsText,
  draftFromCluster,
  featureSeed,
  fetchCardFaces,
  fetchEras,
  fetchFlags,
  fetchGoals,
  fetchModerationLog,
  fetchSeeds,
  fetchSuggestions,
  fetchUsers,
  linkClusterCard,
  mergeClusters,
  RARITIES,
  releaseSuggestion,
  renameUser,
  saveGoal,
  setCardFace,
  setEra,
  setFlag,
  SUGGESTION_STATES,
  SUITS,
  suspendUser,
  text,
  unpublishSeed,
  type CommunityTab,
  type Page,
  type Row,
} from './lib/community';
import { swapView } from './lib/motion';
import { errorMessage } from './lib/supabase';

export const COMMUNITY_LINE =
  'Players, their suggestions and seeds, the card faces, milestones, eras and switches. Every change needs a reason and is written to the moderation log. Nothing loads until you choose a tab.';

export const REASON_FIRST = 'Type a reason first: every change on this tab needs one, and its buttons stay off until there is one.';

type Loader = (cursor: string | null) => Promise<Page>;

/** A list that loads when shown, with Load more for a keyset page, and a refresh after each action. */
function useList(load: Loader) {
  const [items, setItems] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    setError('');
    load(null)
      .then((page) => {
        setItems(page.items);
        setNext(page.next);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, [load]);
  useEffect(refresh, [refresh]);
  const more = () => {
    if (next === null) return;
    load(next)
      .then((page) => {
        setItems((prev) => [...(prev ?? []), ...page.items]);
        setNext(page.next);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  };
  return { items, next, error, refresh, more };
}

interface ActProps {
  reason: string;
  /** True while one action runs: every action button reads as disabled and a second press does nothing. */
  busy: boolean;
  /** Runs one action, after the confirm when one is given; ignored while another runs. */
  run: (label: string, action: () => Promise<unknown>, after: () => void, confirm?: string) => void;
}

/**
 * An action button: off (disabled) until its inputs are ready, and aria-disabled while any action
 * runs, so it keeps focus and a second press does nothing (the run itself ignores it too).
 */
function ActButton({ busy, off, onClick, children, secondary }: { busy: boolean; off: boolean; onClick: () => void; children: ReactNode; secondary?: boolean }) {
  return (
    <button type="button" className={secondary ? 'button-secondary' : undefined} disabled={off} aria-disabled={busy ? 'true' : undefined} onClick={onClick}>
      {children}
    </button>
  );
}

function Listing({ list, empty, children }: { list: ReturnType<typeof useList>; empty: string; children: (items: Row[]) => ReactNode }) {
  return (
    <>
      {list.error !== '' ? (
        <p className="error" role="alert">
          {list.error}
        </p>
      ) : null}
      {list.items === null && list.error === '' ? <p role="status">Loading.</p> : null}
      {list.items !== null && list.items.length === 0 ? <p className="muted">{empty}</p> : null}
      {list.items !== null && list.items.length > 0 ? <div className="table-scroll">{children(list.items)}</div> : null}
      {list.next !== null ? (
        <button type="button" className="button-secondary" onClick={list.more}>
          Load more
        </button>
      ) : null}
    </>
  );
}

function Users({ client, reason, busy, run }: { client: SupabaseClient } & ActProps) {
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const load = useCallback((cursor: string | null) => fetchUsers(client, query, cursor), [client, query]);
  const list = useList(load);
  return (
    <>
      <label>
        Search by handle or name
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <Listing list={list} empty="No players yet.">
        {(items) => (
          <table className="wrap">
            <thead>
              <tr>
                <th scope="col">Handle</th>
                <th scope="col">Name</th>
                <th scope="col">Level</th>
                <th scope="col">XP</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const handle = text(u.handle);
                const suspend = u.suspended !== true;
                return (
                  <tr key={handle} data-handle={handle}>
                    <th scope="row">{handle}</th>
                    <td data-label="Name">{text(u.displayName)}</td>
                    <td data-label="Level">{text(u.level)}</td>
                    <td data-label="XP">{text(u.xp)}</td>
                    <td className="actions">
                      <div className="act-stack">
                        <ActButton
                          busy={busy}
                          off={reason === ''}
                          onClick={() => run(`${suspend ? 'Suspend' : 'Restore'} ${handle}`, () => suspendUser(client, handle, suspend, reason), list.refresh, suspend ? confirmText.suspend(handle) : undefined)}
                        >
                          {suspend ? 'Suspend' : 'Restore'}
                        </ActButton>
                        <input aria-label={`New name for ${handle}`} value={names[handle] ?? ''} onChange={(e) => setNames({ ...names, [handle]: e.target.value })} />
                        <ActButton busy={busy} off={reason === '' || (names[handle] ?? '').trim() === ''} onClick={() => run(`Rename ${handle}`, () => renameUser(client, handle, names[handle]!.trim(), reason), list.refresh)}>
                          Rename
                        </ActButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Listing>
    </>
  );
}

function Suggestions({ client, reason, busy, run }: { client: SupabaseClient } & ActProps) {
  const [state, setState] = useState('');
  const [decline, setDecline] = useState<string>(DECLINE_REASONS[0]);
  const [merges, setMerges] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<Row[]>([]);
  const [cardsError, setCardsError] = useState('');
  const load = useCallback((cursor: string | null) => fetchSuggestions(client, state, cursor), [client, state]);
  const list = useList(load);
  // The newest 50 cards, for Link card's picker: the card a cluster became is a recent one.
  useEffect(() => {
    let live = true;
    fetchCardFaces(client, null)
      .then((page) => {
        if (live) setCards(page.items);
      })
      .catch((cause: unknown) => {
        if (live) setCardsError(errorMessage(cause));
      });
    return () => {
      live = false;
    };
  }, [client]);
  return (
    <>
      <div className="row">
        <label>
          State
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">Every state</option>
            {SUGGESTION_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Decline as
          <select value={decline} onChange={(e) => setDecline(e.target.value)}>
            {DECLINE_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">Player text is shown here for the board only. No agent with write access reads it; the Game Designer drafts from a cluster's structured fields.</p>
      {cardsError !== '' ? (
        <p className="error" role="alert">
          The cards for Link card did not load: {cardsError}
        </p>
      ) : null}
      <Listing list={list} empty="No suggestions in this state.">
        {(items) => {
          const clusters = clusterOptions(items);
          return (
            <table className="wrap">
              <thead>
                <tr>
                  <th scope="col">Suggestion</th>
                  <th scope="col">State</th>
                  <th scope="col">Curator</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const id = text(s.id);
                  const title = text(s.title);
                  const cluster = typeof s.clusterId === 'string' ? s.clusterId : null;
                  const clusterKey = text(s.clusterKey) || (cluster ?? '').slice(0, 8);
                  const triage = (typeof s.triage === 'object' && s.triage !== null ? s.triage : {}) as Row;
                  const into = clusters.find((c) => c.id === merges[id] && c.id !== cluster) ?? null;
                  const card = cards.find((c) => text(c.id) === links[id]) ?? null;
                  return (
                    <tr key={id} data-suggestion={id}>
                      <td>
                        <strong>{title}</strong> <span className="muted">({text(s.area)}, {text(s.votes)} up, by {text(s.author) || 'unknown'})</span>
                        {text(s.body) !== '' ? <p>{text(s.body)}</p> : null}
                      </td>
                      <td data-label="State">
                        {text(s.state)}
                        {s.held ? ' (held)' : ''}
                        {s.declineReason ? `: ${text(s.declineReason)}` : ''}
                      </td>
                      <td data-label="Curator">
                        {text(triage.summary)} <span className="muted">{text(triage.flags)} {text(s.clusterKey)}</span>
                      </td>
                      <td className="actions">
                        <div className="act-stack">
                          <ActButton
                            busy={busy}
                            off={reason === '' || s.state === 'declined'}
                            onClick={() => run('Decline', () => declineSuggestion(client, id, decline, reason), list.refresh, confirmText.decline(title, decline))}
                          >
                            Decline
                          </ActButton>
                          {s.held ? (
                            <ActButton busy={busy} off={reason === ''} onClick={() => run('Release', () => releaseSuggestion(client, id, reason), list.refresh)}>
                              Release
                            </ActButton>
                          ) : null}
                          {cluster !== null ? (
                            <>
                              <ActButton
                                busy={busy}
                                off={reason === ''}
                                onClick={() => run(`Draft from cluster ${clusterKey}`, () => draftFromCluster(client, cluster, reason), list.refresh, confirmText.draft(clusterKey))}
                              >
                                Draft from cluster
                              </ActButton>
                              <select aria-label={`Card to link cluster ${clusterKey} to`} value={card === null ? '' : text(card.id)} onChange={(e) => setLinks({ ...links, [id]: e.target.value })}>
                                <option value="">{cards.length === 0 ? 'No cards loaded' : 'Choose a card'}</option>
                                {cards.map((c) => (
                                  <option key={text(c.id)} value={text(c.id)}>
                                    {`${text(c.title)} (${text(c.stage)})`}
                                  </option>
                                ))}
                              </select>
                              <ActButton
                                busy={busy}
                                off={reason === '' || card === null}
                                onClick={() =>
                                  card === null
                                    ? undefined
                                    : run(
                                        `Link cluster ${clusterKey} to ${text(card.title)}`,
                                        () => linkClusterCard(client, cluster, text(card.id), reason),
                                        list.refresh,
                                        confirmText.link(clusterKey, text(card.title)),
                                      )
                                }
                              >
                                Link card
                              </ActButton>
                              <select aria-label={`Cluster to merge ${clusterKey} into`} value={into === null ? '' : into.id} onChange={(e) => setMerges({ ...merges, [id]: e.target.value })}>
                                <option value="">{clusters.length < 2 ? 'No other cluster loaded' : 'Choose a cluster'}</option>
                                {clusters
                                  .filter((c) => c.id !== cluster)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.key}
                                    </option>
                                  ))}
                              </select>
                              <ActButton
                                busy={busy}
                                off={reason === '' || into === null}
                                onClick={() =>
                                  into === null
                                    ? undefined
                                    : run(`Merge ${clusterKey} into ${into.key}`, () => mergeClusters(client, cluster, into.id, reason), list.refresh, confirmText.merge(clusterKey, into.key))
                                }
                              >
                                Merge into
                              </ActButton>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        }}
      </Listing>
    </>
  );
}

function Seeds({ client, reason, busy, run }: { client: SupabaseClient } & ActProps) {
  const load = useCallback((cursor: string | null) => fetchSeeds(client, cursor), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="No published seeds yet.">
      {(items) => (
        <table className="wrap">
          <thead>
            <tr>
              <th scope="col">Seed</th>
              <th scope="col">Votes</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => {
              const id = text(s.id);
              const publish = s.unpublished === true ? 'Republish' : 'Unpublish';
              const feature = s.featured === true ? 'Unfeature' : 'Feature';
              return (
                <tr key={id} data-seed={id}>
                  <td>
                    <strong>{text(s.title)}</strong> <span className="muted">by {text(s.author)}</span> <code>{text(s.code)}</code>
                  </td>
                  <td data-label="Votes">
                    {text(s.up)} up, {text(s.down)} down
                  </td>
                  <td className="actions">
                    <div className="act-stack">
                      <ActButton busy={busy} off={reason === ''} onClick={() => run(publish, () => unpublishSeed(client, id, s.unpublished !== true, reason), list.refresh)}>
                        {publish}
                      </ActButton>
                      <ActButton busy={busy} off={reason === ''} onClick={() => run(feature, () => featureSeed(client, id, s.featured !== true, reason), list.refresh)}>
                        {feature}
                      </ActButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Listing>
  );
}

function CardFaces({ client, reason, busy, run }: { client: SupabaseClient } & ActProps) {
  const [edits, setEdits] = useState<Record<string, { suit: string; rarity: string }>>({});
  const load = useCallback((cursor: string | null) => fetchCardFaces(client, cursor), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="No cards yet.">
      {(items) => (
        <table className="wrap">
          <thead>
            <tr>
              <th scope="col">Card</th>
              <th scope="col">Suit</th>
              <th scope="col">Rarity</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const id = text(c.id);
              const edit = edits[id] ?? { suit: text(c.suit), rarity: text(c.rarity) };
              return (
                <tr key={id} data-card={id}>
                  <td>
                    {text(c.title)} <span className="muted">({text(c.stage)}; rolled {text(c.computedRarity)})</span>
                  </td>
                  <td data-label="Suit">
                    <select aria-label={`Suit of ${text(c.title)}`} value={edit.suit} onChange={(e) => setEdits({ ...edits, [id]: { ...edit, suit: e.target.value } })}>
                      {SUITS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Rarity">
                    <select aria-label={`Rarity of ${text(c.title)}`} value={edit.rarity} onChange={(e) => setEdits({ ...edits, [id]: { ...edit, rarity: e.target.value } })}>
                      {RARITIES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="actions">
                    <div className="act-stack">
                      <ActButton busy={busy} off={reason === ''} onClick={() => run('Save face', () => setCardFace(client, id, edit.suit, edit.rarity, reason), list.refresh)}>
                        Save
                      </ActButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Listing>
  );
}

const EMPTY_GOAL = { id: null as string | null, dollars: '', title: '', outcome: '', link: '' };

function Goals({ client, reason, busy, run }: { client: SupabaseClient } & ActProps) {
  const amountHintId = useId();
  const [form, setForm] = useState(EMPTY_GOAL);
  const load = useCallback(() => fetchGoals(client), [client]);
  const list = useList(load);
  const cents = centsFrom(form.dollars);
  const badAmount = form.dollars.trim() !== '' && cents === null;
  return (
    <>
      <Listing list={list} empty="No milestones yet.">
        {(items) => (
          <table className="wrap">
            <thead>
              <tr>
                <th scope="col">Milestone</th>
                <th scope="col">Amount</th>
                <th scope="col">State</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => {
                const id = text(g.id);
                const title = text(g.title);
                const amount = dollarsText(g.amountCents);
                return (
                  <tr key={id} data-goal={id}>
                    <td>
                      <strong>{title}</strong> {text(g.outcome)}
                    </td>
                    <td data-label="Amount">{amount}</td>
                    <td data-label="State">{text(g.state)}</td>
                    <td className="actions">
                      <div className="act-stack">
                        <button type="button" className="button-secondary" onClick={() => setForm({ id, dollars: (Number(g.amountCents) / 100).toFixed(2), title, outcome: text(g.outcome), link: text(g.link) })}>
                          Edit
                        </button>
                        <ActButton busy={busy} off={reason === ''} onClick={() => run(`Delete milestone ${title}`, () => deleteGoal(client, id, reason), list.refresh, confirmText.deleteGoal(title, amount))}>
                          Delete
                        </ActButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Listing>
      <h3>{form.id === null ? 'New milestone' : 'Edit milestone'}</h3>
      <label>
        Amount in dollars
        <input inputMode="decimal" aria-describedby={amountHintId} aria-invalid={badAmount ? 'true' : undefined} value={form.dollars} onChange={(e) => setForm({ ...form, dollars: e.target.value })} />
      </label>
      <p id={amountHintId} className={badAmount ? 'error' : 'muted'}>
        {badAmount ? 'That is not an amount. Type one such as 500, $500 or 1,000.50.' : 'Such as 500, $500 or 1,000.50.'}
      </p>
      <label>
        Title
        <input maxLength={80} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label>
        Outcome
        <input maxLength={280} value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} />
      </label>
      <label>
        Link (optional, / or https://)
        <input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
      </label>
      <ActButton
        busy={busy}
        off={reason === '' || cents === null || form.title.trim() === '' || form.outcome.trim() === ''}
        onClick={() =>
          run('Save milestone', () => saveGoal(client, { id: form.id, amountCents: cents!, title: form.title, outcome: form.outcome, link: form.link }, reason), () => {
            setForm(EMPTY_GOAL);
            list.refresh();
          })
        }
      >
        Save milestone
      </ActButton>
    </>
  );
}

function Eras({ client, reason, busy, run }: { client: SupabaseClient } & ActProps) {
  const load = useCallback(() => fetchEras(client), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="No eras.">
      {(items) => (
        <table className="wrap">
          <thead>
            <tr>
              <th scope="col">Era</th>
              <th scope="col">Unlocked by</th>
              <th scope="col">Reached</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const id = text(e.id);
              const name = text(e.name);
              return (
                <tr key={id} data-era={id}>
                  <th scope="row">{name}</th>
                  <td data-label="Unlocked by">{text(e.unlockedBy)}</td>
                  <td data-label="Reached">{text(e.reachedAt) || 'not yet'}</td>
                  <td className="actions">
                    <div className="act-stack">
                      <ActButton busy={busy} off={reason === ''} onClick={() => run(`Set era ${name}`, () => setEra(client, id, reason), list.refresh, confirmText.era(name))}>
                        Set as current
                      </ActButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Listing>
  );
}

function Flags({ client, reason, busy, run }: { client: SupabaseClient } & ActProps) {
  const load = useCallback(() => fetchFlags(client), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="No flags.">
      {(items) => (
        <table className="wrap">
          <thead>
            <tr>
              <th scope="col">Flag</th>
              <th scope="col">Value</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => {
              const key = text(f.key);
              const on = f.value !== true;
              return (
                <tr key={key} data-flag={key}>
                  <th scope="row">{key}</th>
                  <td data-label="Value">{text(f.value)}</td>
                  <td className="actions">
                    {typeof f.value === 'boolean' ? (
                      <div className="act-stack">
                        <ActButton busy={busy} off={reason === ''} onClick={() => run(`Turn ${key} ${on ? 'on' : 'off'}`, () => setFlag(client, key, on, reason), list.refresh, confirmText.flag(key, on))}>
                          Turn {on ? 'on' : 'off'}
                        </ActButton>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Listing>
  );
}

function ModerationLog({ client }: { client: SupabaseClient }) {
  const load = useCallback((cursor: string | null) => fetchModerationLog(client, cursor), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="Nothing logged yet.">
      {(items) => (
        <table className="wrap">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Action</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={text(l.id)} data-log={text(l.id)}>
                <td>{text(l.at)}</td>
                <td data-label="Who">{text(l.actor)}</td>
                <td data-label="Action">
                  {text(l.action)} <span className="muted">{text(l.target)}</span>
                </td>
                <td data-label="Reason">{text(l.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Listing>
  );
}

/**
 * Community admin (docs/specs/community-core.md), under the board's second factor like the rest of the
 * panel. One tab at a time, loaded only when chosen; every change carries the reason typed here.
 */
export function Community({ client }: { client: SupabaseClient }) {
  const reasonHintId = useId();
  const [tab, setTab] = useState<CommunityTab | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The ref answers a second press in the same tick, before the busy state has rendered.
  const running = useRef(false);
  const trimmed = reason.trim();
  const run: ActProps['run'] = (label, action, after, confirm) => {
    if (running.current) return;
    if (confirm !== undefined && !window.confirm(confirm)) return;
    running.current = true;
    setBusy(true);
    setStatus('');
    setError('');
    action()
      .then(() => {
        setStatus(`${label}: done.`);
        after();
      })
      .catch((cause: unknown) => setError(`${label}: ${errorMessage(cause)}`))
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  };
  const props = { client, reason: trimmed, busy, run };
  return (
    <section aria-label="Community">
      <h2>Community</h2>
      <p className="muted">{COMMUNITY_LINE}</p>
      <div className="row" role="group" aria-label="Community tabs">
        {COMMUNITY_TABS.map((name) => (
          <button key={name} type="button" className={tab === name ? undefined : 'button-secondary'} aria-pressed={tab === name} onClick={() => swapView(() => setTab(name))}>
            {name}
          </button>
        ))}
      </div>
      {tab === null ? null : (
        <>
          <label>
            Reason for changes (written to the moderation log)
            <input maxLength={500} aria-describedby={trimmed === '' ? reasonHintId : undefined} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {trimmed === '' && tab !== 'Moderation log' ? (
            <p id={reasonHintId} className="muted">
              {REASON_FIRST}
            </p>
          ) : null}
          {status !== '' ? <p role="status">{status}</p> : null}
          {error !== '' ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <h3>{tab}</h3>
          {tab === 'Users' ? <Users {...props} /> : null}
          {tab === 'Suggestions' ? <Suggestions {...props} /> : null}
          {tab === 'Seeds' ? <Seeds {...props} /> : null}
          {tab === 'Card faces' ? <CardFaces {...props} /> : null}
          {tab === 'Goals' ? <Goals {...props} /> : null}
          {tab === 'Studio eras' ? <Eras {...props} /> : null}
          {tab === 'Flags' ? <Flags {...props} /> : null}
          {tab === 'Moderation log' ? <ModerationLog client={client} /> : null}
        </>
      )}
    </section>
  );
}
