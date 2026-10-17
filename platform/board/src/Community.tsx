import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  centsFrom,
  COMMUNITY_TABS,
  DECLINE_REASONS,
  declineSuggestion,
  deleteGoal,
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
import { errorMessage } from './lib/supabase';

export const COMMUNITY_LINE =
  'Players, their suggestions and seeds, the card faces, milestones, eras and switches. Every change needs a reason and is written to the moderation log. Nothing loads until you choose a tab.';

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
  run: (label: string, action: () => Promise<unknown>, after: () => void) => void;
}

function Listing({ list, empty, children }: { list: ReturnType<typeof useList>; empty: string; children: (items: Row[]) => ReactNode }) {
  return (
    <>
      {list.error !== '' ? <p className="error">{list.error}</p> : null}
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

function Users({ client, reason, run }: { client: SupabaseClient } & ActProps) {
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
          <table>
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
                return (
                  <tr key={handle} data-handle={handle}>
                    <th scope="row">{handle}</th>
                    <td>{text(u.displayName)}</td>
                    <td>{text(u.level)}</td>
                    <td>{text(u.xp)}</td>
                    <td>
                      <button type="button" disabled={reason === ''} onClick={() => run(`${u.suspended ? 'Restore' : 'Suspend'} ${handle}`, () => suspendUser(client, handle, u.suspended !== true, reason), list.refresh)}>
                        {u.suspended ? 'Restore' : 'Suspend'}
                      </button>{' '}
                      <input aria-label={`New name for ${handle}`} value={names[handle] ?? ''} onChange={(e) => setNames({ ...names, [handle]: e.target.value })} />{' '}
                      <button type="button" disabled={reason === '' || (names[handle] ?? '').trim() === ''} onClick={() => run(`Rename ${handle}`, () => renameUser(client, handle, names[handle]!.trim(), reason), list.refresh)}>
                        Rename
                      </button>
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

function Suggestions({ client, reason, run }: { client: SupabaseClient } & ActProps) {
  const [state, setState] = useState('');
  const [decline, setDecline] = useState<string>(DECLINE_REASONS[0]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const load = useCallback((cursor: string | null) => fetchSuggestions(client, state, cursor), [client, state]);
  const list = useList(load);
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
      <Listing list={list} empty="No suggestions in this state.">
        {(items) => (
          <table>
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
                const cluster = typeof s.clusterId === 'string' ? s.clusterId : null;
                const triage = (typeof s.triage === 'object' && s.triage !== null ? s.triage : {}) as Row;
                const target = targets[id] ?? '';
                return (
                  <tr key={id} data-suggestion={id}>
                    <td>
                      <strong>{text(s.title)}</strong> <span className="muted">({text(s.area)}, {text(s.votes)} up, by {text(s.author) || 'unknown'})</span>
                      {text(s.body) !== '' ? <p>{text(s.body)}</p> : null}
                    </td>
                    <td>
                      {text(s.state)}
                      {s.held ? ' (held)' : ''}
                      {s.declineReason ? `: ${text(s.declineReason)}` : ''}
                    </td>
                    <td>
                      {text(triage.summary)} <span className="muted">{text(triage.flags)} {text(s.clusterKey)}</span>
                    </td>
                    <td>
                      <button type="button" disabled={reason === '' || s.state === 'declined'} onClick={() => run('Decline', () => declineSuggestion(client, id, decline, reason), list.refresh)}>
                        Decline
                      </button>{' '}
                      {s.held ? (
                        <button type="button" disabled={reason === ''} onClick={() => run('Release', () => releaseSuggestion(client, id, reason), list.refresh)}>
                          Release
                        </button>
                      ) : null}{' '}
                      {cluster !== null ? (
                        <>
                          <button type="button" disabled={reason === ''} onClick={() => run('Draft from cluster', () => draftFromCluster(client, cluster, reason), list.refresh)}>
                            Draft from cluster
                          </button>{' '}
                          <input aria-label={`Card or cluster id for ${id}`} value={target} onChange={(e) => setTargets({ ...targets, [id]: e.target.value })} />{' '}
                          <button type="button" disabled={reason === '' || target.trim() === ''} onClick={() => run('Link card', () => linkClusterCard(client, cluster, target.trim(), reason), list.refresh)}>
                            Link card
                          </button>{' '}
                          <button type="button" disabled={reason === '' || target.trim() === ''} onClick={() => run('Merge cluster', () => mergeClusters(client, cluster, target.trim(), reason), list.refresh)}>
                            Merge into
                          </button>
                        </>
                      ) : null}
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

function Seeds({ client, reason, run }: { client: SupabaseClient } & ActProps) {
  const load = useCallback((cursor: string | null) => fetchSeeds(client, cursor), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="No published seeds yet.">
      {(items) => (
        <table>
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
              return (
                <tr key={id} data-seed={id}>
                  <td>
                    <strong>{text(s.title)}</strong> <span className="muted">by {text(s.author)}</span> <code>{text(s.code)}</code>
                  </td>
                  <td>
                    {text(s.up)} up, {text(s.down)} down
                  </td>
                  <td>
                    <button type="button" disabled={reason === ''} onClick={() => run('Unpublish', () => unpublishSeed(client, id, s.unpublished !== true, reason), list.refresh)}>
                      {s.unpublished ? 'Republish' : 'Unpublish'}
                    </button>{' '}
                    <button type="button" disabled={reason === ''} onClick={() => run('Feature', () => featureSeed(client, id, s.featured !== true, reason), list.refresh)}>
                      {s.featured ? 'Unfeature' : 'Feature'}
                    </button>
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

function CardFaces({ client, reason, run }: { client: SupabaseClient } & ActProps) {
  const [edits, setEdits] = useState<Record<string, { suit: string; rarity: string }>>({});
  const load = useCallback((cursor: string | null) => fetchCardFaces(client, cursor), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="No cards yet.">
      {(items) => (
        <table>
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
                  <td>
                    <select aria-label={`Suit of ${text(c.title)}`} value={edit.suit} onChange={(e) => setEdits({ ...edits, [id]: { ...edit, suit: e.target.value } })}>
                      {SUITS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select aria-label={`Rarity of ${text(c.title)}`} value={edit.rarity} onChange={(e) => setEdits({ ...edits, [id]: { ...edit, rarity: e.target.value } })}>
                      {RARITIES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button type="button" disabled={reason === ''} onClick={() => run('Save face', () => setCardFace(client, id, edit.suit, edit.rarity, reason), list.refresh)}>
                      Save
                    </button>
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

function Goals({ client, reason, run }: { client: SupabaseClient } & ActProps) {
  const [form, setForm] = useState(EMPTY_GOAL);
  const load = useCallback(() => fetchGoals(client), [client]);
  const list = useList(load);
  const cents = centsFrom(form.dollars);
  return (
    <>
      <Listing list={list} empty="No milestones yet.">
        {(items) => (
          <table>
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
                return (
                  <tr key={id} data-goal={id}>
                    <td>
                      <strong>{text(g.title)}</strong> {text(g.outcome)}
                    </td>
                    <td>${(Number(g.amountCents) / 100).toFixed(2)}</td>
                    <td>{text(g.state)}</td>
                    <td>
                      <button type="button" className="button-secondary" onClick={() => setForm({ id, dollars: (Number(g.amountCents) / 100).toFixed(2), title: text(g.title), outcome: text(g.outcome), link: text(g.link) })}>
                        Edit
                      </button>{' '}
                      <button type="button" disabled={reason === ''} onClick={() => run('Delete milestone', () => deleteGoal(client, id, reason), list.refresh)}>
                        Delete
                      </button>
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
        <input inputMode="decimal" value={form.dollars} onChange={(e) => setForm({ ...form, dollars: e.target.value })} />
      </label>
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
      <button
        type="button"
        disabled={reason === '' || cents === null || form.title.trim() === '' || form.outcome.trim() === ''}
        onClick={() =>
          run('Save milestone', () => saveGoal(client, { id: form.id, amountCents: cents!, title: form.title, outcome: form.outcome, link: form.link }, reason), () => {
            setForm(EMPTY_GOAL);
            list.refresh();
          })
        }
      >
        Save milestone
      </button>
    </>
  );
}

function Eras({ client, reason, run }: { client: SupabaseClient } & ActProps) {
  const load = useCallback(() => fetchEras(client), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="No eras.">
      {(items) => (
        <table>
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
              return (
                <tr key={id} data-era={id}>
                  <th scope="row">{text(e.name)}</th>
                  <td>{text(e.unlockedBy)}</td>
                  <td>{text(e.reachedAt) || 'not yet'}</td>
                  <td>
                    <button type="button" disabled={reason === ''} onClick={() => run(`Set era ${text(e.name)}`, () => setEra(client, id, reason), list.refresh)}>
                      Set as current
                    </button>
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

function Flags({ client, reason, run }: { client: SupabaseClient } & ActProps) {
  const load = useCallback(() => fetchFlags(client), [client]);
  const list = useList(load);
  return (
    <Listing list={list} empty="No flags.">
      {(items) => (
        <table>
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
              return (
                <tr key={key} data-flag={key}>
                  <th scope="row">{key}</th>
                  <td>{text(f.value)}</td>
                  <td>
                    {typeof f.value === 'boolean' ? (
                      <button type="button" disabled={reason === ''} onClick={() => run(`Turn ${key} ${f.value ? 'off' : 'on'}`, () => setFlag(client, key, !f.value, reason), list.refresh)}>
                        Turn {f.value ? 'off' : 'on'}
                      </button>
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
        <table>
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
                <td>{text(l.actor)}</td>
                <td>
                  {text(l.action)} <span className="muted">{text(l.target)}</span>
                </td>
                <td>{text(l.reason)}</td>
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
  const [tab, setTab] = useState<CommunityTab | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const trimmed = reason.trim();
  const run: ActProps['run'] = (label, action, after) => {
    setStatus('');
    setError('');
    action()
      .then(() => {
        setStatus(`${label}: done.`);
        after();
      })
      .catch((cause: unknown) => setError(`${label}: ${errorMessage(cause)}`));
  };
  const props = { client, reason: trimmed, run };
  return (
    <section aria-label="Community">
      <h2>Community</h2>
      <p className="muted">{COMMUNITY_LINE}</p>
      <div className="row" role="group" aria-label="Community tabs">
        {COMMUNITY_TABS.map((name) => (
          <button key={name} type="button" className={tab === name ? undefined : 'button-secondary'} aria-pressed={tab === name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      {tab === null ? null : (
        <>
          <label>
            Reason for changes (written to the moderation log)
            <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {status !== '' ? <p role="status">{status}</p> : null}
          {error !== '' ? <p className="error">{error}</p> : null}
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
