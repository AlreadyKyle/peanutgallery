// The studio's mark (docs/specs/machine-mark.md): a small machine with a screen, two pixel eyes, a
// coin slot and two feet, on a 32-unit grid. It is one even-odd path drawn in the text colour, so it
// is ink on paper and paper on the signal plate and ink bands with no filter, and CanvasText under
// forced colours. Its box is its ink (x 4 to 28, y 2 to 32), which styles.css draws at one pixel a
// unit. platform/site/brand/mark.svg is the same drawing and box (App.test.tsx holds them equal);
// the icons and the link preview are made from that file. Kernel: the top bar draws it.

export const MARK_PATH =
  'M8 2H24A4 4 0 0 1 28 6V24A4 4 0 0 1 24 28H22V31A1 1 0 0 1 21 32H19A1 1 0 0 1 18 31V28H14V31A1 1 0 0 1 13 32H11A1 1 0 0 1 10 31V28H8A4 4 0 0 1 4 24V6A4 4 0 0 1 8 2ZM10 6H22A2 2 0 0 1 24 8V14A2 2 0 0 1 22 16H10A2 2 0 0 1 8 14V8A2 2 0 0 1 10 6ZM11 10H13A1 1 0 0 1 14 11V13A1 1 0 0 1 13 14H11A1 1 0 0 1 10 13V11A1 1 0 0 1 11 10ZM19 10H21A1 1 0 0 1 22 11V13A1 1 0 0 1 21 14H19A1 1 0 0 1 18 13V11A1 1 0 0 1 19 10ZM15 18H17A1 1 0 0 1 18 19V23A1 1 0 0 1 17 24H15A1 1 0 0 1 14 23V19A1 1 0 0 1 15 18Z';

/** The mark, decorative: the link or heading beside it carries the name. */
export function MachineMark() {
  return (
    <svg className="mark" viewBox="4 2 24 30" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
