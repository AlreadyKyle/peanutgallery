import { expect, test } from './fixtures';

// The play pill sits over the explainer's poster (docs/specs/explainer-video.md). The poster is the
// first frame every visitor sees and the only one a visitor who asked for reduced motion ever does, so
// the pill must not cover the picture at any width. The pill keeps one size while the frame shrinks (the
// home hero's frame is 460px wide at a 1024px viewport and 544px from 1200px), which once put it over
// "Watch AI agents build it." on iPad landscape. The check reads the poster's own pixels under the
// pill, so it holds for any poster the explainer job draws.
test.use({ reducedMotion: 'reduce' });

// Both cuts (below 768 the 4:5 phone poster, from 768 the 16:9 one) and the widths around the hero's
// two-column switch at 1024 and the frame's 544px limit at 1200.
const WIDTHS = [320, 375, 414, 767, 768, 900, 1023, 1024, 1060, 1100, 1140, 1160, 1200, 1440, 1920];

/** How many pixels of the poster under the pill differ from its background, and the pill's own size. */
async function pictureUnderPill(page: import('@playwright/test').Page): Promise<{ ink: number; pixels: number; pill: { width: number; height: number } }> {
  return page.evaluate(async () => {
    const frame = document.querySelector('.explainer-frame')!;
    const img = frame.querySelector<HTMLImageElement>('.explainer-poster img')!;
    const pill = frame.querySelector('.explainer-play')!;
    await img.decode();
    const box = img.getBoundingClientRect();
    const at = pill.getBoundingClientRect();
    // object-fit: cover: the image is scaled to fill the box and the overflow is cut evenly.
    const scale = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const cutX = (img.naturalWidth * scale - box.width) / 2;
    const cutY = (img.naturalHeight * scale - box.height) / 2;
    const sx = Math.max(0, Math.floor((at.left - box.left + cutX) / scale));
    const sy = Math.max(0, Math.floor((at.top - box.top + cutY) / scale));
    const sw = Math.min(img.naturalWidth - sx, Math.ceil(at.width / scale));
    const sh = Math.min(img.naturalHeight - sy, Math.ceil(at.height / scale));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const data = context.getImageData(0, 0, sw, sh).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Against the region's first pixel, past what JPEG noise on a flat plate reaches.
      const diff = Math.max(Math.abs(data[i]! - data[0]!), Math.abs(data[i + 1]! - data[1]!), Math.abs(data[i + 2]! - data[2]!));
      if (diff > 40) ink += 1;
    }
    return { ink, pixels: sw * sh, pill: { width: at.width, height: at.height } };
  });
}

for (const path of ['/', '/how-it-works']) {
  for (const width of WIDTHS) {
    test(`the play pill covers none of the poster's picture at ${width}px on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const button = page.getByRole('button', { name: 'Play the video' });
      await expect(button).toBeVisible();
      const { ink, pixels, pill } = await pictureUnderPill(page);
      expect(pixels).toBeGreaterThan(1000);
      expect(ink, `${ink} of ${pixels} poster pixels under the pill differ from its background`).toBe(0);
      // Whatever shape the pill takes, it stays a 44px touch target with its name.
      expect(pill.width).toBeGreaterThanOrEqual(44);
      expect(pill.height).toBeGreaterThanOrEqual(44);
    });
  }
}
