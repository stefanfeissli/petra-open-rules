// #1772 (open-rules.md §8 Phase B2, scope item 2): the domain-allowlist
// READ path — zero external dependencies (only node:fs/node:path/node:url),
// deliberately separate from sourceDomains.mjs's GENERATION path (which
// needs `js-yaml` to parse the monorepo's own ruleset corpus).
//
// Codex review, PR #1803 round 1, P1 "Vendor the runtime dependency used by
// the public gate": cli.mjs used to import `effectiveAllowlist`/
// `DEFAULT_OUTPUT_PATH` from sourceDomains.mjs, which has a top-level
// `import yaml from 'js-yaml'` — a STATIC import is resolved the moment the
// module loads, regardless of whether the importing code ever calls a
// function that actually uses it. The staged public repo (repo-scaffold/
// .github/gate/) has no package.json, no lockfile, no node_modules: a clean
// `actions/checkout` + `setup-node` with no install step would hit
// `ERR_MODULE_NOT_FOUND` on `js-yaml` before a single corridor was ever
// checked. This module is what cli.mjs (and the public repo's own copy of
// it) actually imports — sourceDomains.mjs re-exports everything here for
// the monorepo-side CLI/tests, but the public repo copy is THIS file, never
// that one (see repoScaffoldSync.test.mjs).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_OUTPUT_PATH = join(HERE, '..', 'source-domains.json');
// The staged copy the public repo's own gate reads (repo-scaffold/.github/
// source-domains.json — see contribution-gate.yml). open-rules-publish.yml
// also copies this file on every real publish.
export const SCAFFOLD_OUTPUT_PATH = join(HERE, '..', 'repo-scaffold', '.github', 'source-domains.json');

/** Lower-cased hostname for a URL string, or null if it doesn't parse. */
export function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {string} [deps.outputPath]
 * @param {(path: string, enc: string) => string} [deps.readFile]
 * @returns {{ schema_version: number, generated_from: string, generated: string[], owner_additions: string[] }}
 */
export function loadSourceDomainsFile({ outputPath = DEFAULT_OUTPUT_PATH, readFile = readFileSync } = {}) {
  return JSON.parse(readFile(outputPath, 'utf8'));
}

/** The full effective allowlist: generated + owner_additions, deduplicated, sorted. */
export function effectiveAllowlist(sourceDomainsFile) {
  const generated = Array.isArray(sourceDomainsFile?.generated) ? sourceDomainsFile.generated : [];
  const ownerAdditions = Array.isArray(sourceDomainsFile?.owner_additions) ? sourceDomainsFile.owner_additions : [];
  return [...new Set([...generated, ...ownerAdditions])].sort();
}

export function isDomainAllowed(domain, sourceDomainsFile) {
  if (!domain) return false;
  return effectiveAllowlist(sourceDomainsFile).includes(domain.toLowerCase());
}
