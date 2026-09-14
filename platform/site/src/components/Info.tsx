import { useEffect, useId, useRef, useState } from 'react';
import { copy } from '../lib/copy';

/**
 * A round "i" button beside a term, with a tooltip that explains it. Hover and focus show the
 * tooltip while they last; a click or tap pins it open until the next click, Escape, blur or a
 * pointer press outside. A tap also raises the synthetic mouseenter and focus, so the click
 * pins rather than toggles the open state, or the first tap would open and close in one go.
 */
export function Info({ term, text }: { term: string; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const wrapper = useRef<HTMLSpanElement>(null);

  const close = () => {
    pinned.current = false;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapper.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <span
      className="info"
      ref={wrapper}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned.current) setOpen(false);
      }}
    >
      <button
        type="button"
        className="info-button"
        aria-label={`${copy.about} ${term}`}
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={() => {
          if (pinned.current) {
            close();
          } else {
            pinned.current = true;
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      <span role="tooltip" id={id} className="tooltip" hidden={!open}>
        {text}
      </span>
    </span>
  );
}
