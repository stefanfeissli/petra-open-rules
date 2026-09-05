#!/usr/bin/env node
// #1772 (open-rules.md §8 Phase B2, "Automated checks (CI on the public
// repo)"): the actual entry point the public repo's CI workflow runs on
// every pull request (see repo-scaffold/.github/workflows/contribution-
// gate.yml). This monorepo's own tests (fixtures.test.mjs) invoke the SAME
// module functions this CLI calls — collectChangesetFromDirs + runGate —
// so a green fixture suite here is evidence about the real gate, not a
// parallel reimplementation of it.
//
// Usage:
//   node tools/open-rules/gate/cli.mjs --base <baseDir> --head <headDir> [--allowlist <path>] [--now <ISO date>]
//
// On the public repo, <baseDir>/<headDir> are two checkouts of the same
// repo at the PR's base and head commits (a real CI job produces these
// with two `actions/checkout` steps, or one checkout plus `git worktree
// add` — see contribution-gate.yml for the exact recipe). `--allowlist`
// defaults to this repo's own tools/open-rules/source-domains.json; a
// real public-repo CI run vendors that same file alongside this script
// (contribution-gate.yml copies it in — see that workflow's own comment).
import { readFileSync } from 'node:fs';
import { collectChangesetFromDirs } from './collectChangeset.mjs';
import { runGate, formatGateReport } from './runGate.mjs';
// Codex review, PR #1803 round 1, P1 "Vendor the runtime dependency used by
// the public gate": imports allowlist.mjs, NOT sourceDomains.mjs —
// sourceDomains.mjs has a top-level `import yaml from 'js-yaml'` (needed
// for the MONOREPO-side allowlist generation), and the public repo this
// CLI actually runs in has no package.json/node_modules to resolve that
// from. allowlist.mjs has zero external dependencies.
import { DEFAULT_OUTPUT_PATH, effectiveAllowlist } from './allowlist.mjs';

function parseArgs(argv) {
  const args = { allowlistPath: DEFAULT_OUTPUT_PATH, now: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') args.base = argv[++i];
    else if (arg === '--head') args.head = argv[++i];
    else if (arg === '--allowlist') args.allowlistPath = argv[++i];
    else if (arg === '--now') args.now = argv[++i];
  }
  return args;
}

export function main(argv, { readFile = readFileSync, exit = process.exit, log = console.log } = {}) {
  const { base, head, allowlistPath, now } = parseArgs(argv);
  if (!base || !head) {
    log('Usage: node tools/open-rules/gate/cli.mjs --base <baseDir> --head <headDir> [--allowlist <path>] [--now <ISO date>]');
    exit(2);
    return;
  }
  const allowlistFile = JSON.parse(readFile(allowlistPath, 'utf8'));
  const allowlist = effectiveAllowlist(allowlistFile);
  const changeset = collectChangesetFromDirs({ baseDir: base, headDir: head });
  const verdict = runGate(changeset, { allowlist, now: now ? new Date(now) : undefined });
  log(formatGateReport(verdict));
  exit(verdict.ok ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main(process.argv.slice(2));
}
