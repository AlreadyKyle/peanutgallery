import React from 'react';
import { Composition } from 'remotion';
import './fonts';
import './styles.css';
import { CLIP_FPS, CLIP_FRAMES, Moment, type ClipProps } from './Moment';

const sample: ClipProps = {
  kicker: 'Shipped in Dust',
  title: 'Cheaper first Gatherer',
  summary: 'The first unit you can buy now costs 10 dust instead of 11, so your first buy comes sooner.',
  role: 'Builder A',
  suit: 'game',
  rows: [
    { label: 'Agent work', value: '$0.80', money: true },
    { label: 'Paid from', value: 'Contributions' },
  ],
  state: 'live',
  ctaTop: 'Play Dust free in your browser',
  ctaUrl: 'mobmachine.games',
};

export function Root() {
  return <Composition id="moment" component={Moment} durationInFrames={CLIP_FRAMES} fps={CLIP_FPS} width={1080} height={1920} defaultProps={sample} />;
}
