import { continueRender, delayRender, staticFile } from 'remotion';

// The site's font (Atkinson Hyperlegible Next, SIL OFL 1.1). No frame is drawn until it loads.
const handle = delayRender('Loading Atkinson Hyperlegible Next');
const face = new FontFace('Atkinson Hyperlegible Next', `url(${staticFile('atkinson-hyperlegible-next-400-700.woff2')}) format('woff2')`, { weight: '400 700', style: 'normal' });
face.load().then((loaded) => { document.fonts.add(loaded); continueRender(handle); });
