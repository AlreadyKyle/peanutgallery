import { useCurrentFrame } from 'remotion';
import { at, pop, progress, wobble } from '../anim';
import { Avatar } from '../components/Avatar';
import { At, Stage } from '../components/Stage';
import { roster } from '../data';
import type { Format } from '../format';
import { C, EASE_IN, FONT } from '../theme';
import { BEAT, CHOREO } from '../timeline';

// The running agents, each drawn by code from its species note, popping up one to an eighth note.
// They bob on the beat and blink now and then; they never speak.
export function Team({ format }: { format: Format }) {
  const frame = useCurrentFrame();
  const c = CHOREO.team;
  return (
    <Stage format={format}>
      {roster.map((agent, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 150 + col * 300;
        const y = 130 + row * 280;
        const up = pop(frame, at(c.pops[i]!), 'bouncy');
        const out = progress(frame, at(c.exit) + i * 3, 24, EASE_IN);
        // Each blink cue closes one agent's eyes for six frames, a different agent each time.
        const blinking = c.blinks.some((b, j) => (j * 4 + 1) % roster.length === i && frame >= at(b) && frame < at(b) + 6);
        // A small hop on each beat once the agent is up.
        const beatPhase = ((frame + i * 7) % BEAT) / BEAT;
        const hop = up > 0.98 ? Math.max(0, Math.sin(beatPhase * Math.PI)) * 4 : 0;
        return (
          <div key={agent.title}>
            <At x={x} y={y - hop + out * 60} w={180} h={180} scale={up * (1 - out * 0.4)} opacity={1 - out}>
              <div style={{ transformOrigin: '50% 100%', transform: `rotate(${wobble(frame, i, 2)}deg)` }}>
                <Avatar note={agent.note} size={180} blink={blinking} />
              </div>
            </At>
            <At x={x} y={y + 118} w={280} h={40} opacity={Math.min(1, up) * (1 - out)}>
              <div style={{ textAlign: 'center', fontFamily: FONT, fontSize: 25, fontWeight: 600, color: C.ink, transform: `translateY(${(1 - Math.min(1, up)) * 12}px)` }}>{agent.title}</div>
            </At>
          </div>
        );
      })}
    </Stage>
  );
}
