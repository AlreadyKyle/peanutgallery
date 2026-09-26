import path from 'node:path';

/** Every module a file loads at run time: static imports and re-exports that are not type-only, side-effect imports and dynamic imports. */
export function runtimeImports(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const typeOnly = match[2] !== undefined || /^\{\s*(type\s+[A-Za-z_$][\w$]*\s*,?\s*)+\}$/.test(match[3]!.trim());
    if (!typeOnly) out.push(match[4]!);
  }
  for (const match of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(match[1]!);
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(match[1]!);
  for (const match of text.matchAll(/\bimport\s*\(\s*[^'"\s)]/g)) out.push(`<computed import at ${match.index}>`);
  return out;
}

/**
 * Every repository file a Node entry loads, directly or through another file: the entries themselves
 * and each relative import, resolved as TypeScript and Node resolve it (the file as named, then with
 * .ts, .tsx, .mts, .mjs or .js, then an index file; a .js name also as .ts). `read` returns a file's
 * text, or null when there is no such file. Package imports are left out: packages come from the
 * lockfile, a kernel file. What cannot be followed is returned as a problem: a relative import that
 * resolves to no file, a computed dynamic import, and an import of a workspace package (@backseat/),
 * whose code lives in the repository.
 */
export function importClosure(entries: readonly string[], read: (file: string) => string | null): { files: string[]; problems: string[] } {
  const files = new Set<string>();
  const problems: string[] = [];
  const queue = [...entries];
  const resolve = (from: string, specifier: string): string | null => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`];
    if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
    return candidates.find((candidate) => read(candidate) !== null) ?? null;
  };
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    const text = read(file);
    if (text === null) {
      problems.push(`${file} is missing`);
      continue;
    }
    files.add(file);
    for (const specifier of runtimeImports(text)) {
      if (specifier.startsWith('<computed')) problems.push(`${file} has a ${specifier.slice(1, -1)}`);
      else if (specifier.startsWith('@backseat/')) problems.push(`${file} imports the workspace package ${specifier}`);
      else if (specifier.startsWith('.')) {
        const target = resolve(file, specifier);
        if (target === null) problems.push(`${file} imports ${specifier}, which resolves to no file`);
        else queue.push(target);
      }
    }
  }
  return { files: [...files].sort(), problems };
}
