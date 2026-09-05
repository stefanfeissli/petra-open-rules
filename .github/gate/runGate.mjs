// #1772 (open-rules.md §8 Phase B2): orchestrates every check into one
// pass/fail verdict with named reasons — "Failing any check = red, no human
// time spent" (scope item 2). This is the single function both the fixture
// tests and the real CLI (cli.mjs) call.
import { checkSingleCorridorScope, runContentChecks } from './checks.mjs';

/**
 * @param {ReturnType<import('./collectChangeset.mjs').collectChangesetFromRecords>} changeset
 * @param {object} opts
 * @param {string[]} opts.allowlist - effective domain allowlist (sourceDomains.mjs's effectiveAllowlist()).
 * @param {Date} [opts.now]
 * @returns {{ ok: boolean, results: Array<{ name: string, ok: boolean, skipped?: boolean, reason: string|null }> }}
 */
export function runGate(changeset, { allowlist, now } = {}) {
  const scopeResult = checkSingleCorridorScope(changeset);
  const contentResults = runContentChecks(changeset, { allowlist, now });
  const results = [scopeResult, ...contentResults];
  const ok = results.every((r) => r.ok);
  return { ok, results };
}

/** Renders a gate verdict as the line-per-check text a CI log / PR comment shows. */
export function formatGateReport({ ok, results }) {
  const lines = results.map((r) => {
    if (r.skipped) return `SKIP  ${r.name} (not applicable)`;
    if (r.ok) return `PASS  ${r.name}`;
    return `FAIL  ${r.name}: ${r.reason}`;
  });
  lines.push(ok ? 'RESULT: green — every check passed.' : 'RESULT: red — see the named failure(s) above.');
  return lines.join('\n');
}
