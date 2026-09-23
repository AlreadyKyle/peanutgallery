#!/usr/bin/env node
// payment-host-scan.mjs: fails when a build carries a payment address other than the one Payment
// Link the site is configured with (docs/specs/board-site.md).
//
// usage: node payment-host-scan.mjs [--allow-from <netlify.toml>] [--allow <url>] <build-folder> ...
//
// Every file under each build folder is read, bundles and source maps included; binary media is
// skipped. JSON-escaped slashes (\/) and URL-encoded ones (%2F, %3A) are read as plain, so an escaped
// address is still seen. A payment address is any address on a domain in payment-hosts.txt beside
// this script, or on a subdomain of one, with or without a scheme, with the rest of the address up
// to a quote, space, angle bracket, backtick, parenthesis or backslash. The only address allowed is
// the Payment Link: exactly the VITE_STRIPE_PAYMENT_LINK_URL value in the named netlify.toml, or the
// --allow value, which must be https://buy.stripe.com/<id>. With neither, no payment address is
// allowed at all (the game's build). The card id the site adds to the link is added at runtime, so
// the build holds the bare link.
//
// It stops a build that names another payment page, whether a card wrote it or a dependency slipped
// it in. It cannot see an address assembled at runtime from pieces; the enforced form-action and
// connect-src policies and the kernel payment files cover the rest.
//
// First stdout line: PASS: payment-host-scan files=<n> allowed=<k> or
// FAIL: payment-host-scan path=<file> address=<address>, then one line per address found.
// Exit 0 pass, 1 fail, 2 usage (a missing folder, or an allowed link that is not a Payment Link).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYMENT_LINK = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp3|ogg|wav|mp4|webm|zip|gz|br|wasm|pdf)$/i;

function usage(message) {
  console.log(`FAIL: payment-host-scan usage: ${message}`);
  console.error('usage: node payment-host-scan.mjs [--allow-from <netlify.toml>] [--allow <url>] <build-folder> ...');
  process.exit(2);
}

export function paymentDomains(file = join(HERE, 'payment-hosts.txt')) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** The Payment Link a netlify.toml builds the site with, or null when it names none. */
export function paymentLinkFrom(toml) {
  return toml.match(/^\s*VITE_STRIPE_PAYMENT_LINK_URL\s*=\s*"([^"]*)"\s*$/m)?.[1] ?? null;
}

export function addressPattern(domains) {
  const hosts = domains.map((domain) => domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(
    `(?<![A-Za-z0-9.@-])(?:https?:)?(?://)?(?:[A-Za-z0-9-]+\\.)*(?:${hosts})(?![A-Za-z0-9-])(?::\\d+)?(?:[/?#][^\\s"'\`<>()\\\\]*)?`,
    'gi',
  );
}

/** Every payment address in a text, after reading escaped slashes and colons as plain. */
export function addressesIn(text, pattern) {
  const plain = text.replace(/\\\//g, '/').replace(/%2f/gi, '/').replace(/%3a/gi, ':');
  return [...plain.matchAll(pattern)].map((match) => match[0].replace(/[.,;]+$/, ''));
}

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '.DS_Store') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...filesUnder(path));
    else if (stat.isFile() && !BINARY.test(name)) out.push(path);
  }
  return out;
}

function main(argv) {
  let allowed = null;
  const folders = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-from') {
      const file = argv[++index];
      if (file === undefined || !existsSync(file)) usage(`--allow-from needs a netlify.toml that exists: ${file ?? ''}`);
      allowed = paymentLinkFrom(readFileSync(file, 'utf8'));
      if (allowed === null) usage(`${file} sets no VITE_STRIPE_PAYMENT_LINK_URL`);
    } else if (arg === '--allow') {
      allowed = argv[++index] ?? usage('--allow needs a URL');
    } else if (arg.startsWith('--')) {
      usage(`unknown option ${arg}`);
    } else {
      folders.push(resolve(arg));
    }
  }
  if (folders.length === 0) usage('name at least one build folder');
  if (allowed !== null && !PAYMENT_LINK.test(allowed)) usage(`the allowed link is not a Payment Link address: ${allowed}`);
  for (const folder of folders) {
    if (!existsSync(folder) || !statSync(folder).isDirectory()) usage(`not a folder: ${folder}`);
  }

  const pattern = addressPattern(paymentDomains());
  const bad = [];
  let files = 0;
  let allowedCount = 0;
  for (const folder of folders) {
    for (const file of filesUnder(folder)) {
      files += 1;
      for (const address of addressesIn(readFileSync(file, 'latin1'), pattern)) {
        if (allowed !== null && address === allowed) allowedCount += 1;
        else bad.push({ file: relative(process.cwd(), file), address });
      }
    }
  }
  if (bad.length > 0) {
    console.log(`FAIL: payment-host-scan path=${bad[0].file} address=${bad[0].address}`);
    for (const { file, address } of bad) console.log(`payment-host-scan: ${file} carries ${address}`);
    process.exit(1);
  }
  console.log(`PASS: payment-host-scan files=${files} allowed=${allowedCount}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
