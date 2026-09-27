import { continueRender, delayRender, staticFile } from 'remotion';

// The site's one font file (Atkinson Hyperlegible Next, SIL OFL 1.1), copied into the render's public
// folder by scripts/render.mjs. No frame is drawn until it has loaded, so no frame shows the fallback.
const handle = delayRender('Loading Atkinson Hyperlegible Next');
const face = new FontFace('Atkinson Hyperlegible Next', `url(${staticFile('atkinson-hyperlegible-next-400-700.woff2')}) format('woff2')`, {
  weight: '400 700',
  style: 'normal',
});
face
  .load()
  .then((loaded) => {
    document.fonts.add(loaded);
    continueRender(handle);
  })
  .catch((error: unknown) => {
    throw new Error(`The font did not load: ${String(error)}`);
  });
