/**
 * The one polite announcer: funded and shipped cards are said here once. It is always in the page,
 * so a screen reader hears text as it arrives.
 */
export function Announcer({ message }: { message: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite" data-announcer="">
      {message}
    </p>
  );
}
