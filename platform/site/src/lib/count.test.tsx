import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FUND_URL } from '../pages/Broadcast';
import {
  CHANNEL_SOURCES,
  countEvent,
  DWELL_MARKS,
  DwellClock,
  fromQr,
  isCheckoutLink,
  isDiscordLink,
  isGameLink,
  MAX_DWELL_STEP_MS,
  onceEach,
  QR_SOURCE,
  SOURCE_PARAM,
  sourceEvent,
  useSiteCounts,
  withoutSource,
  withQrSource,
  type PlayEvent,
} from './count';

// The site's counters (docs/specs/play-counts.md, docs/specs/counter-senders.md): the event's name
// alone, to the site's own /api/count, decided from the route, the visible time on home, the QR
// code's source tag and a press on a Discord link, a Payment Link or, on home, a link into the game.

const INVITE = 'https://discord.gg/mob-machine';
const PLAY = 'https://play.mobmachine.games';
const CHECKOUT = 'https://buy.stripe.com/test_link?client_reference_id=split20';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('countEvent', () => {
  it('sends the event name alone as a beacon to /api/count', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const fetchFn = vi.fn();
    const events = ['home_load', 'home_dwell_mid', 'home_dwell_long', 'broadcast_load', 'broadcast_qr', 'discord_click', 'contribute_load', 'checkout_open', 'home_play_click'] as const;
    for (const event of events) countEvent(event, { sendBeacon }, fetchFn);
    expect(sendBeacon.mock.calls.map((call) => call[1])).toEqual(events.map((event) => `{"event":"${event}"}`));
    expect(new Set(sendBeacon.mock.calls.map((call) => call[0]))).toEqual(new Set(['/api/count']));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to a keepalive fetch with no credentials, and never throws', () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
    expect(() => countEvent('home_load', {}, fetchFn)).not.toThrow();
    expect(fetchFn).toHaveBeenCalledWith('/api/count', {
      method: 'POST',
      body: '{"event":"home_load"}',
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(() => countEvent('home_load', { sendBeacon: () => { throw new Error('no'); } }, fetchFn)).not.toThrow();
  });
});

describe('onceEach', () => {
  it('passes each event on once', () => {
    const sent: PlayEvent[] = [];
    const once = onceEach((event) => sent.push(event));
    for (const event of ['broadcast_load', 'discord_click', 'broadcast_load', 'discord_click', 'broadcast_qr'] as const) once(event);
    expect(sent).toEqual(['broadcast_load', 'discord_click', 'broadcast_qr']);
  });
});

describe('DwellClock', () => {
  it('reaches 15 and then 45 seconds of visible time, each once', () => {
    expect(DWELL_MARKS.map((mark) => [mark.event, mark.ms])).toEqual([
      ['home_dwell_mid', 15_000],
      ['home_dwell_long', 45_000],
    ]);
    const clock = new DwellClock();
    const reached: string[] = [];
    let now = 1_000_000;
    clock.advance(now, true);
    for (let second = 1; second <= 120; second += 1) {
      const marks = clock.advance((now += 1000), true);
      if (marks.length > 0) reached.push(`${second}:${marks.join(',')}`);
    }
    expect(reached).toEqual(['15:home_dwell_mid', '45:home_dwell_long']);
  });

  it('does not count hidden time, a long gap in the checks or a clock set back', () => {
    const clock = new DwellClock();
    let now = 1_000_000;
    clock.advance(now, true);
    for (let second = 0; second < 10; second += 1) clock.advance((now += 1000), true);
    for (let second = 0; second < 120; second += 1) expect(clock.advance((now += 1000), false)).toEqual([]);
    expect(clock.shown).toBe(10_000);
    expect(clock.advance((now += 60_000), true)).toEqual(['home_dwell_mid']);
    expect(clock.shown).toBe(10_000 + MAX_DWELL_STEP_MS);
    clock.advance(now - 30_000, true);
    expect(clock.shown).toBe(10_000 + MAX_DWELL_STEP_MS);
  });
});

describe('the QR source tag', () => {
  it("is on /broadcast's QR address, and only there", () => {
    expect(FUND_URL).toBe('https://mobmachine.games/contribute?from=broadcast');
    expect(withQrSource('https://mobmachine.games/contribute')).toBe(FUND_URL);
    expect(`${SOURCE_PARAM}=${QR_SOURCE}`).toBe('from=broadcast');
  });

  it('is read from the query and dropped from it, keeping anything else', () => {
    expect(fromQr('?from=broadcast')).toBe(true);
    expect(fromQr('?a=1&from=broadcast')).toBe(true);
    expect(fromQr('')).toBe(false);
    expect(fromQr('?from=elsewhere')).toBe(false);
    expect(withoutSource('?from=broadcast')).toBe('');
    expect(withoutSource('?a=1&from=broadcast')).toBe('?a=1');
  });
});

describe('a channel landing (docs/specs/channel-counters.md)', () => {
  it("names from_<tag> for a listed channel, broadcast_qr for the QR code's tag, and nothing else", () => {
    for (const tag of CHANNEL_SOURCES) expect(sourceEvent(`?from=${tag}`)).toBe(`from_${tag}`);
    expect(sourceEvent('?a=1&from=hn')).toBe('from_hn');
    expect(sourceEvent('?from=broadcast')).toBe('broadcast_qr');
    expect(sourceEvent('')).toBeNull();
    expect(sourceEvent('?from=elsewhere')).toBeNull();
    expect(sourceEvent('?from=X')).toBeNull();
  });
});

describe('isDiscordLink', () => {
  it("matches the site's invite and Discord's own hosts, and nothing else", () => {
    expect(isDiscordLink(INVITE, INVITE)).toBe(true);
    expect(isDiscordLink('https://discord.gg/other', '')).toBe(true);
    expect(isDiscordLink('https://discord.com/channels/1/2', '')).toBe(true);
    expect(isDiscordLink('https://ptb.discord.com/invite/x', '')).toBe(true);
    expect(isDiscordLink('https://discordapp.com/invite/x', '')).toBe(true);
    expect(isDiscordLink('https://mobmachine.games/faq', INVITE)).toBe(false);
    expect(isDiscordLink('https://notdiscord.gg/x', INVITE)).toBe(false);
    expect(isDiscordLink('https://discord.gg.example.com/x', INVITE)).toBe(false);
    expect(isDiscordLink('', '')).toBe(false);
    expect(isDiscordLink('not a url', '')).toBe(false);
  });
});

describe('isCheckoutLink and isGameLink (the funnel)', () => {
  it('takes an https link on buy.stripe.com as a Payment Link, and nothing else', () => {
    expect(isCheckoutLink(CHECKOUT)).toBe(true);
    expect(isCheckoutLink('https://BUY.stripe.com/abc')).toBe(true);
    expect(isCheckoutLink('http://buy.stripe.com/abc')).toBe(false);
    expect(isCheckoutLink('https://buy.stripe.com.example.com/abc')).toBe(false);
    expect(isCheckoutLink('https://stripe.com/abc')).toBe(false);
    expect(isCheckoutLink('https://mobmachine.games/contribute')).toBe(false);
    expect(isCheckoutLink('not a url')).toBe(false);
  });

  it("takes a link to the play address's origin, with any query, as a link into the game", () => {
    expect(isGameLink(PLAY, PLAY)).toBe(true);
    expect(isGameLink(`${PLAY}/`, PLAY)).toBe(true);
    expect(isGameLink(`${PLAY}/?from=card`, PLAY)).toBe(true);
    expect(isGameLink('https://mobmachine.games/', PLAY)).toBe(false);
    expect(isGameLink('https://play.mobmachine.games.example.com/', PLAY)).toBe(false);
    expect(isGameLink(PLAY, '')).toBe(false);
    expect(isGameLink('', PLAY)).toBe(false);
    // A play address with a path matches that path and what is under it.
    expect(isGameLink('https://example.com/play/?seed=1', 'https://example.com/play')).toBe(true);
    expect(isGameLink('https://example.com/player', 'https://example.com/play')).toBe(false);
    expect(isGameLink('https://example.com/', 'https://example.com/play')).toBe(false);
  });
});

describe('useSiteCounts', () => {
  let sent: PlayEvent[];
  let once: (event: PlayEvent) => void;
  const send = (event: PlayEvent) => sent.push(event);

  beforeEach(() => {
    sent = [];
    once = onceEach(send);
    vi.useFakeTimers({ now: 1_000_000, toFake: ['setInterval', 'clearInterval', 'Date'] });
  });

  // A frame that mounts the counts with one router, and links to move between pages.
  function Frame() {
    useSiteCounts({ discordInvite: INVITE, playUrl: PLAY }, send, once);
    const navigate = useNavigate();
    const location = useLocation();
    const [, rerender] = useState(0);
    return (
      <div>
        <p data-testid="where">{location.pathname + location.search + location.hash}</p>
        <button type="button" onClick={() => navigate('/')}>home</button>
        <button type="button" onClick={() => navigate('/team')}>team</button>
        <button type="button" onClick={() => navigate('/broadcast')}>broadcast</button>
        <button type="button" onClick={() => navigate('/contribute')}>contribute</button>
        <button type="button" onClick={() => rerender((n) => n + 1)}>rerender</button>
        <a href={INVITE} onClick={(event) => event.preventDefault()}>Discord</a>
        <a href="https://discord.com/x" onClick={(event) => event.preventDefault()}>
          <span>Discord channel</span>
        </a>
        <a href="/faq" onClick={(event) => event.preventDefault()}>FAQ</a>
        <a href={CHECKOUT} onClick={(event) => event.preventDefault()}>
          <span>Fund this card</span>
        </a>
        <a href={PLAY} onClick={(event) => event.preventDefault()}>Play free</a>
        <a href={`${PLAY}/?from=card`} onClick={(event) => event.preventDefault()}>
          <span>Play Dust</span>
        </a>
      </div>
    );
  }

  function mount(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Frame />
      </MemoryRouter>,
    );
  }

  const seconds = (n: number) => act(() => vi.advanceTimersByTime(n * 1000));

  it('counts each view of home, and its dwell at 15 and 45 seconds while it is shown', () => {
    const view = mount('/');
    expect(sent).toEqual(['home_load']);
    seconds(14);
    expect(sent).toEqual(['home_load']);
    seconds(1);
    expect(sent).toEqual(['home_load', 'home_dwell_mid']);
    fireEvent.click(view.getByText('rerender'));
    seconds(30);
    expect(sent).toEqual(['home_load', 'home_dwell_mid', 'home_dwell_long']);
    seconds(300);
    expect(sent).toHaveLength(3);
    // Another page stops the clock; coming back is another view of home with its own dwell.
    fireEvent.click(view.getByText('team'));
    seconds(60);
    expect(sent).toHaveLength(3);
    fireEvent.click(view.getByText('home'));
    seconds(20);
    expect(sent).toEqual(['home_load', 'home_dwell_mid', 'home_dwell_long', 'home_load', 'home_dwell_mid']);
  });

  it('leaving home before 15 seconds counts the view and no dwell', () => {
    const view = mount('/');
    seconds(10);
    fireEvent.click(view.getByText('team'));
    seconds(120);
    expect(sent).toEqual(['home_load']);
  });

  it('does not count a hidden tab as a view or as time on home', () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      mount('/');
      seconds(120);
      expect(sent).toEqual([]);
      hidden.mockReturnValue('visible');
      seconds(1);
      expect(sent).toEqual(['home_load']);
      seconds(14);
      expect(sent).toEqual(['home_load', 'home_dwell_mid']);
    } finally {
      hidden.mockRestore();
    }
  });

  it('counts /broadcast once a page load, and nothing for other pages', () => {
    const view = mount('/team');
    expect(sent).toEqual([]);
    fireEvent.click(view.getByText('broadcast'));
    fireEvent.click(view.getByText('team'));
    fireEvent.click(view.getByText('broadcast'));
    expect(sent).toEqual(['broadcast_load']);
  });

  it('counts a landing from the QR code once and drops the tag from the address', () => {
    const view = mount('/contribute?from=broadcast#how');
    expect(sent).toEqual(['broadcast_qr', 'contribute_load']);
    expect(view.getByTestId('where').textContent).toBe('/contribute#how');
    fireEvent.click(view.getByText('rerender'));
    expect(sent).toEqual(['broadcast_qr', 'contribute_load']);
  });

  it("counts a landing from a channel's tagged link once and drops the tag, keeping the rest", () => {
    const view = mount('/card/abc?from=reddit&x=1#steps');
    expect(sent).toEqual(['from_reddit']);
    expect(view.getByTestId('where').textContent).toBe('/card/abc?x=1#steps');
    fireEvent.click(view.getByText('rerender'));
    expect(sent).toEqual(['from_reddit']);
  });

  it('leaves an address with an unknown tag as it is and counts nothing for it', () => {
    const view = mount('/team?from=elsewhere');
    expect(sent).toEqual([]);
    expect(view.getByTestId('where').textContent).toBe('/team?from=elsewhere');
  });

  it('counts a press on a Discord link once a page load, and leaves other links alone', () => {
    const view = mount('/team');
    fireEvent.click(view.getByText('FAQ'));
    expect(sent).toEqual([]);
    fireEvent.click(view.getByText('Discord channel'));
    fireEvent.click(view.getByText('Discord'));
    expect(sent).toEqual(['discord_click']);
  });

  it('counts a middle-button press on a Discord link', () => {
    const view = mount('/team');
    fireEvent(view.getByText('Discord'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(sent).toEqual(['discord_click']);
  });

  it('counts /contribute once a page load, however it is reached', () => {
    const view = mount('/team');
    expect(sent).toEqual([]);
    fireEvent.click(view.getByText('contribute'));
    fireEvent.click(view.getByText('rerender'));
    fireEvent.click(view.getByText('team'));
    fireEvent.click(view.getByText('contribute'));
    expect(sent).toEqual(['contribute_load']);
  });

  it('counts a press on a Payment Link once a page load, on any page, and a right-button press not at all', () => {
    const view = mount('/team');
    fireEvent(view.getByText('Fund this card'), new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(sent).toEqual([]);
    fireEvent.click(view.getByText('Fund this card'));
    fireEvent.click(view.getByText('home'));
    fireEvent.click(view.getByText('Fund this card'));
    expect(sent.filter((event) => event === 'checkout_open')).toEqual(['checkout_open']);
  });

  it('counts a press on a link into the game once a view of home, and nothing on another page', () => {
    const view = mount('/team');
    fireEvent.click(view.getByText('Play free'));
    expect(sent).toEqual([]);
    fireEvent.click(view.getByText('home'));
    fireEvent.click(view.getByText('FAQ'));
    fireEvent.click(view.getByText('Discord'));
    expect(sent).toEqual(['home_load', 'discord_click']);
    fireEvent.click(view.getByText('Play free'));
    fireEvent.click(view.getByText('Play Dust'));
    expect(sent).toEqual(['home_load', 'discord_click', 'home_play_click']);
    // Another view of home counts its own press, a middle-button one included.
    fireEvent.click(view.getByText('team'));
    fireEvent.click(view.getByText('home'));
    fireEvent(view.getByText('Play Dust'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(sent).toEqual(['home_load', 'discord_click', 'home_play_click', 'home_load', 'home_play_click']);
  });

  it('counts no press into the game when the site has no play address', () => {
    function NoPlay() {
      useSiteCounts({ discordInvite: INVITE, playUrl: '' }, send, once);
      return <a href={PLAY} onClick={(event) => event.preventDefault()}>Play free</a>;
    }
    const view = render(
      <MemoryRouter initialEntries={['/']}>
        <NoPlay />
      </MemoryRouter>,
    );
    fireEvent.click(view.getByText('Play free'));
    expect(sent).toEqual(['home_load']);
  });
});
