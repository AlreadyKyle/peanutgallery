// The studio line under the stage ("Made by AI agents at Mob Machine · All ages · See what players are
// funding next", in index.html) wraps on a phone. Its separators are plain text there, so a wrap
// would leave a line ending on "·". This marks each separator as its own element, and the last link
// as the funding link, so render/style.css can put that link on its own line and drop the separator
// before it on a narrow screen. The words, the links and the all-ages label are left exactly as the
// page has them; the separators are decoration, so assistive technology skips them.

const SEPARATOR = '·';

export function markStudioLine(line: HTMLElement): void {
  const doc = line.ownerDocument;
  const separators: HTMLElement[] = [];
  for (const node of Array.from(line.childNodes)) {
    if (node.nodeType !== 3 || !(node.textContent ?? '').includes(SEPARATOR)) continue;
    const parts = (node.textContent ?? '').split(SEPARATOR);
    const pieces: Node[] = [];
    parts.forEach((part, index) => {
      if (index > 0) {
        const separator = doc.createElement('span');
        separator.className = 'studio-sep';
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = SEPARATOR;
        separators.push(separator);
        pieces.push(separator);
      }
      if (part !== '') pieces.push(doc.createTextNode(part));
    });
    node.replaceWith(...pieces);
  }
  separators[separators.length - 1]?.classList.add('studio-sep-last');
  const links = line.querySelectorAll('a');
  if (links.length > 1) links[links.length - 1]!.classList.add('studio-next');
}
