import { motionAllowed } from './motion';

// The idle bob (DESIGN.md, Motion): an agent on the team strip or a running box on /team breathes
// the way an idle agent in the live studio does (StudioRoom.tsx), a slow sine lift of the body over
// a ground shadow that stays put. One frame loop for every avatar on the page, drawn by script so it
// can stop: off screen, in a hidden tab, and under reduced motion, where nothing is registered and
// the avatar is drawn still. Only a transform moves, so nothing around it shifts. An avatar inside a
// link holds still while the link is pointed at or focused, as an agent in the room does.

/** The room's bob: a sine of 700ms a radian, 1.1 room units high, here in the avatar's own units (the room draws avatars at 0.42). */
const RADIAN_MS = 700;
const LIFT = 1.1 / 0.42;
/** The lift grows in over this long, so a page that opens does not jump to a mid-bob pose. */
const EASE_IN_MS = 1200;

type Figure = { el: SVGGElement; phase: number; clock: number; onScreen: boolean };

const figures = new Set<Figure>();
let frame = 0;
let last = 0;
let observer: IntersectionObserver | null = null;

function held(figure: Figure): boolean {
  const host = figure.el.closest('a');
  return host !== null && host.matches(':hover, :focus');
}

function draw(t: number): void {
  // A frame after a pause (a hidden tab, every avatar off screen) carries on from where it stopped.
  const dt = last === 0 ? 0 : Math.min(t - last, 100);
  last = t;
  for (const figure of figures) {
    if (!figure.onScreen) continue;
    // Held, its own clock stops, so it rests where it is and carries on from there when let go.
    if (!held(figure)) figure.clock += dt;
    const lift = Math.sin(figure.clock / RADIAN_MS + figure.phase) * LIFT * Math.min(1, figure.clock / EASE_IN_MS);
    figure.el.setAttribute('transform', `translate(0 ${lift.toFixed(2)})`);
  }
}

function running(): boolean {
  return document.visibilityState === 'visible' && [...figures].some((figure) => figure.onScreen);
}

function loop(t: number): void {
  draw(t);
  frame = running() ? requestAnimationFrame(loop) : 0;
}

function start(): void {
  if (frame !== 0 || !running()) return;
  last = 0;
  frame = requestAnimationFrame(loop);
}

function observe(): IntersectionObserver | null {
  if (observer !== null || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      for (const figure of figures) if (figure.el === entry.target) figure.onScreen = entry.isIntersecting;
    }
    start();
  });
  document.addEventListener('visibilitychange', start);
  return observer;
}

/**
 * Starts the idle bob on `el`, an avatar's body group, at `phase` radians into its rhythm, so
 * agents side by side never move as one. Returns the function that stops it and draws it at rest.
 * Under reduced motion it does nothing.
 */
export function watchIdle(el: SVGGElement, phase: number): () => void {
  if (!motionAllowed()) return () => undefined;
  const watcher = observe();
  const figure: Figure = { el, phase, clock: 0, onScreen: watcher === null };
  figures.add(figure);
  watcher?.observe(el);
  start();
  return () => {
    figures.delete(figure);
    watcher?.unobserve(el);
    el.removeAttribute('transform');
    if (figures.size === 0 && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
