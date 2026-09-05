// #1772 (open-rules.md §8 Phase B2): turns two directory trees (the base
// ref's checkout and the PR head's checkout of the public repo) into the
// plain `{ changedPaths, baseFiles, headFiles }` shape checks.mjs's pure
// functions consume. This is the only module in the gate that touches the
// filesystem — everything downstream (checks.mjs, runGate.mjs) is pure and
// testable without it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Codex review, PR #1803 round 1, P1 "Exclude checkout metadata from the
// corridor diff": the real CI workflow (contribution-gate.yml) checks out
// base and head into two SEPARATE `actions/checkout` directories, each with
// its own `.git` directory (HEAD, index, logs, refs, objects) that differs
// between the two commits by construction — recursing into it would put
// dozens of `.git/*` paths into `changedPaths` and fail
// `single-corridor-scope` on every legitimate one-file PR. `.git` (and, for
// the same reason, any other VCS metadata directory) is never part of the
// repository's own tracked content and is skipped outright.
const SKIPPED_DIR_NAMES = new Set(['.git']);

/** Recursively lists every regular file under `dir` (skipping VCS metadata directories), as POSIX-style paths relative to `dir`. */
function listFiles(dir, { readdir = readdirSync, stat = statSync } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdir(current)) {
      if (SKIPPED_DIR_NAMES.has(entry)) continue;
      const full = join(current, entry);
      const st = stat(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        out.push(relative(dir, full).split(sep).join('/'));
      }
    }
  }
  return out;
}

/**
 * @param {object} deps
 * @param {string} deps.baseDir - checkout of the PR's base ref (e.g. `main`).
 * @param {string} deps.headDir - checkout of the PR's head ref.
 * @returns {{ changedPaths: string[], baseFiles: Map<string,string>, headFiles: Map<string,string> }}
 */
export function collectChangesetFromDirs({ baseDir, headDir, readFile = readFileSync, readdir = readdirSync, stat = statSync }) {
  const baseFiles = new Map();
  for (const path of listFiles(baseDir, { readdir, stat })) {
    baseFiles.set(path, readFile(join(baseDir, path), 'utf8'));
  }
  const headFiles = new Map();
  for (const path of listFiles(headDir, { readdir, stat })) {
    headFiles.set(path, readFile(join(headDir, path), 'utf8'));
  }
  const allPaths = new Set([...baseFiles.keys(), ...headFiles.keys()]);
  const changedPaths = [...allPaths].filter((path) => baseFiles.get(path) !== headFiles.get(path)).sort();
  return { changedPaths, baseFiles, headFiles };
}

/**
 * Builds a changeset directly from explicit file maps — the shape the
 * fixture tests use when they don't want two on-disk directories (a
 * brand-new-corridor fixture, for instance, where `baseFiles` deliberately
 * has no entry for the file at all).
 * @param {{ base: Record<string,string>, head: Record<string,string> }} files
 */
export function collectChangesetFromRecords({ base = {}, head = {} }) {
  const baseFiles = new Map(Object.entries(base));
  const headFiles = new Map(Object.entries(head));
  const allPaths = new Set([...baseFiles.keys(), ...headFiles.keys()]);
  const changedPaths = [...allPaths].filter((path) => baseFiles.get(path) !== headFiles.get(path)).sort();
  return { changedPaths, baseFiles, headFiles };
}
