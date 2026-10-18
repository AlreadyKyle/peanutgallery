#!/usr/bin/env node
// game-stack.mjs: every game is a Three.js web game with box art (docs/specs/final-state.md, Games;
// docs/specs/operations.md). The gate runs it over a game folder (seed-*) before anything is built.
//
// usage: node game-stack.mjs <game folder> [...]
//
// A game folder fails when:
// - its package.json does not list three under dependencies;
// - its package.json lists another renderer or game engine (Phaser, PixiJS, Babylon.js, PlayCanvas,
//   Kaboom or KAPLAY, Excalibur, melonJS, Cocos, A-Frame, p5, LittleJS, CreateJS, OGL, regl, twgl and
//   the like) in any dependency list;
// - a source file outside node_modules and dist imports or requires one of them, or an HTML file
//   loads one from a script tag;
// - it has no box-art.svg, or the box art is not one SVG drawn in code: a 3:4 viewBox, no script, no
//   event handler, nothing loaded from outside the file.
// First stdout line: PASS: game-stack folders=<n> or FAIL: game-stack folder=<f> reason=<why>.
// Exit 0 pass, 1 fail, 2 usage.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Package names (or scopes, ending in /) of renderers and engines a game may not depend on.
export const REFUSED = [
  'phaser', 'phaser3', 'phaser-ce', '@phaserjs/',
  'pixi.js', 'pixi.js-legacy', '@pixi/', 'pixi',
  'babylonjs', '@babylonjs/',
  'playcanvas', '@playcanvas/',
  'kaboom', 'kaplay',
  'excalibur',
  'melonjs',
  'cocos2d-html5', 'cocos-creator', '@cocos/',
  'aframe',
  'p5',
  'littlejsengine',
  'createjs', 'easeljs', '@createjs/',
  'ogl', 'regl', 'twgl.js',
  'godot', '@godot/',
  'impact', 'egret', 'hilo', '@lightningjs/', 'lightningjs',
  'gdevelop', 'construct3',
];

const SOURCE = /\.(?:[cm]?[jt]sx?|html?|vue|svelte)$/i;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.cache', 'coverage', 'test-results', 'playwright-report']);

export function refusedName(name) {
  const lower = name.toLowerCase();
  return REFUSED.some((refused) => (refused.endsWith('/') ? lower.startsWith(refused) : lower === refused || lower.startsWith(`${refused}/`)));
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// The module specifiers a file names: import ... from 'x', import('x'), require('x'), export ... from 'x'.
export function specifiers(text) {
  const found = [];
  for (const match of text.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"\n]+)['"]|\brequire\s*\(\s*['"]([^'"\n]+)['"]/g)) {
    found.push(match[1] ?? match[2]);
  }
  return found;
}

// A script tag's src that names a refused engine, e.g. a CDN copy of Phaser.
function scriptEngine(text) {
  for (const match of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const file = match[1].toLowerCase().split(/[?#]/)[0].split('/').pop() ?? '';
    const stem = file.replace(/(\.min)?\.m?js$/, '').replace(/[@-]v?\d.*$/, '');
    if (stem && refusedName(stem)) return match[1];
    const pkg = /\/npm\/(@[^/]+\/[^/@]+|[^/@]+)/.exec(match[1]);
    if (pkg && refusedName(pkg[1])) return match[1];
  }
  return null;
}

// Why the box art is refused, or null.
export function boxArtProblem(svg) {
  const text = svg.replace(/^﻿/, '').replace(/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*/, '');
  if (!/^<svg\b/i.test(text)) return 'box-art.svg is not an SVG';
  const viewBox = /<svg\b[^>]*\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(text);
  if (!viewBox) return 'box-art.svg has no viewBox';
  const ratio = Number(viewBox[1]) / Number(viewBox[2]);
  if (!(Math.abs(ratio - 0.75) < 0.01)) return `box-art.svg is not a 3:4 cover (viewBox ${viewBox[1]} by ${viewBox[2]})`;
  if (/<script\b/i.test(text)) return 'box-art.svg carries a script';
  if (/\son[a-z]+\s*=/i.test(text)) return 'box-art.svg carries an event handler';
  if (/(?:href|src)\s*=\s*["'](?!#|data:image\/(?:png|svg\+xml);base64,)[^"']*["']/i.test(text)) return 'box-art.svg loads something from outside the file';
  if (/@import|url\(\s*["']?(?!#)/i.test(text)) return 'box-art.svg loads something from outside the file';
  return null;
}

// Why the game folder is refused, or null.
export function gameProblem(dir) {
  const pkgFile = path.join(dir, 'package.json');
  if (!existsSync(pkgFile)) return 'no package.json';
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  } catch {
    return 'package.json is not JSON';
  }
  const lists = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies'];
  for (const list of lists) {
    const deps = pkg[list];
    const names = Array.isArray(deps) ? deps : Object.keys(deps ?? {});
    const refused = names.find(refusedName);
    if (refused) return `package.json depends on ${refused}; games are Three.js only`;
  }
  if (!pkg.dependencies || typeof pkg.dependencies.three !== 'string') return 'package.json does not depend on three';
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(dir, file);
    const spec = specifiers(text).find(refusedName);
    if (spec) return `${rel} imports ${spec}; games are Three.js only`;
    const script = /\.html?$/i.test(file) ? scriptEngine(text) : null;
    if (script) return `${rel} loads ${script}; games are Three.js only`;
  }
  const art = path.join(dir, 'box-art.svg');
  if (!existsSync(art) || !statSync(art).isFile()) return 'no box-art.svg';
  return boxArtProblem(readFileSync(art, 'utf8'));
}

function main(argv) {
  if (argv.length === 0) {
    console.log('FAIL: game-stack usage: name at least one game folder');
    return 2;
  }
  for (const dir of argv) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      console.log(`FAIL: game-stack usage: not a folder: ${dir}`);
      return 2;
    }
  }
  for (const dir of argv) {
    const problem = gameProblem(dir);
    if (problem) {
      console.log(`FAIL: game-stack folder=${path.basename(path.resolve(dir))} reason=${problem}`);
      return 1;
    }
  }
  console.log(`PASS: game-stack folders=${argv.length}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
