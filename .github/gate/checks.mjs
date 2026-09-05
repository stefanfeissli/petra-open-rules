// #1772 (open-rules.md §8 Phase B2, "Automated checks" scope item 2): the
// contribution gate's pure check functions. Every check takes plain
// objects/strings — never touches the filesystem or git — so they run
// identically here (fixture tests) and inside the real gate CLI
// (collectChangeset.mjs + cli.mjs) the public repo's CI would invoke.
//
// Each check returns { name, ok, reason } — `reason` is a short, named
// explanation a CI log line can show verbatim (this story's AC1: "fails
// with a named reason"), never a stack trace or a generic "failed".
// `ok: true, skipped: true` means the check does not apply to this
// changeset (e.g. protected-field checks on a brand-new corridor file,
// which has no "before" to compare against) — a skip never fails the gate
// and is reported separately from a pass so a human reading the log can
// tell "checked, clean" from "not applicable here" apart.

// scope item 2's protected-field list verbatim: "no field the contributor
// may not set (`version`, `history_url`, `license*`, `last_reviewed`)".
// `license*` covers both `license` and `license_scope`; `no_warranty` is
// the same boilerplate-licence-text family and is included for the same
// reason (a contributor rewriting the warranty disclaimer is exactly the
// defect this list exists to catch).
export const PROTECTED_FIELDS = ['version', 'history_url', 'license', 'license_scope', 'no_warranty', 'last_reviewed'];

// scope item 2: "every changed requirement carries a sources[] entry with
// retrieved_at within 90 days" — the freshness window.
export const SOURCE_FRESHNESS_DAYS = 90;

const CORRIDOR_FILE_RE = /^corridors\/[^/]+\.json$/;

function ok(name) {
  return { name, ok: true, reason: null };
}
function skip(name) {
  return { name, ok: true, skipped: true, reason: null };
}
function fail(name, reason) {
  return { name, ok: false, reason };
}

/**
 * scope item 2, "the diff touches one corridor only": the whole PR must
 * change exactly one file, and that file must be `corridors/<slug>.json`
 * (a bare filename, no nested path — no `corridors/x/y.json`).
 */
export function checkSingleCorridorScope(changeset) {
  const name = 'single-corridor-scope';
  const { changedPaths } = changeset;
  if (changedPaths.length !== 1) {
    return fail(
      name,
      `PR must change exactly one corridor file; found ${changedPaths.length} changed path(s): ${changedPaths.join(', ') || '(none)'}`,
    );
  }
  const [only] = changedPaths;
  if (!CORRIDOR_FILE_RE.test(only)) {
    return fail(name, `the one changed file ('${only}') is not a corridors/<slug>.json record`);
  }
  return ok(name);
}

/** True when the changeset is exactly one changed corridors/<slug>.json file — the precondition every other content check below needs. */
function hasSingleCorridorChange(changeset) {
  return changeset.changedPaths.length === 1 && CORRIDOR_FILE_RE.test(changeset.changedPaths[0]);
}

const REQUIRED_STRING_FIELDS = [
  'corridor',
  'tier',
  'tier_label',
  'last_reviewed',
  'url',
  'disclaimer',
  'license',
  'license_scope',
  'no_warranty',
  'version',
  'history_url',
];

/**
 * A deliberately lightweight structural check against the #1763 dataset
 * shape (apps/landing/lib/corridors/dataset.ts's CorridorDatasetRecord) —
 * required top-level fields present with the right basic type, every
 * requirement/checklist row shaped correctly. Not a full JSON-Schema
 * validator: Rule 10 rigor here is spent on the adversarial provenance
 * fixtures (AC1), not on exhaustively re-deriving #1763's TypeScript type
 * as a second schema language.
 */
export function checkSchemaShape(afterJson) {
  const name = 'schema-shape';
  if (afterJson === null || typeof afterJson !== 'object') {
    return fail(name, 'file does not parse as a JSON object');
  }
  if (afterJson.schema_version !== 1) {
    return fail(name, `schema_version must be 1, got ${JSON.stringify(afterJson.schema_version)}`);
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof afterJson[field] !== 'string' || afterJson[field].length === 0) {
      return fail(name, `missing or non-string required field '${field}'`);
    }
  }
  if (!afterJson.origin || typeof afterJson.origin.code !== 'string' || typeof afterJson.origin.name !== 'string') {
    return fail(name, "missing or malformed 'origin' ({ code, name })");
  }
  if (!afterJson.destination || typeof afterJson.destination.code !== 'string' || typeof afterJson.destination.name !== 'string') {
    return fail(name, "missing or malformed 'destination' ({ code, name })");
  }
  if (!Array.isArray(afterJson.sources)) {
    return fail(name, "'sources' must be an array");
  }
  if (!Array.isArray(afterJson.requirements)) {
    return fail(name, "'requirements' must be an array");
  }
  if (!Array.isArray(afterJson.manual_checklist)) {
    return fail(name, "'manual_checklist' must be an array");
  }
  for (const req of afterJson.requirements) {
    if (typeof req?.key !== 'string' || typeof req?.title !== 'string') {
      return fail(name, "every requirements[] entry needs a string 'key' and 'title'");
    }
    if (!Array.isArray(req.scope_notes ?? [])) {
      return fail(name, `requirement '${req.key}': scope_notes must be an array when present`);
    }
  }
  for (const item of afterJson.manual_checklist) {
    if (typeof item?.title !== 'string') {
      return fail(name, "every manual_checklist[] entry needs a string 'title'");
    }
  }
  for (const source of afterJson.sources) {
    if (typeof source?.url !== 'string' || source.url.length === 0) {
      return fail(name, "every sources[] entry needs a string 'url'");
    }
  }
  return ok(name);
}

/** JSON canonical formatting: 2-space indent + trailing newline, matching every generator-produced record in this dataset. */
export function checkCanonicalFormatting(afterRaw, afterJson) {
  const name = 'canonical-formatting';
  if (afterJson === null || typeof afterJson !== 'object') {
    return skip(name); // schema-shape already reports the parse failure; nothing to reformat.
  }
  const expected = `${JSON.stringify(afterJson, null, 2)}\n`;
  if (afterRaw !== expected) {
    return fail(name, 'file is not canonically formatted (2-space indented JSON with a single trailing newline)');
  }
  return ok(name);
}

/** scope item 2: fields the contributor may never set/change (PROTECTED_FIELDS). Skipped for a brand-new corridor file (no "before" to compare against). */
export function checkProtectedFields(beforeJson, afterJson) {
  const name = 'protected-fields';
  if (beforeJson === undefined) return skip(name);
  if (afterJson === null || typeof afterJson !== 'object') return skip(name);
  const changed = PROTECTED_FIELDS.filter((field) => JSON.stringify(beforeJson[field]) !== JSON.stringify(afterJson[field]));
  if (changed.length > 0) {
    return fail(name, `contributor changed protected field(s): ${changed.join(', ')}`);
  }
  return ok(name);
}

/** scope item 2: "no change to the disclaimer ... text". Skipped for a brand-new corridor file. */
export function checkDisclaimerUnchanged(beforeJson, afterJson) {
  const name = 'disclaimer-unchanged';
  if (beforeJson === undefined) return skip(name);
  if (afterJson === null || typeof afterJson !== 'object') return skip(name);
  if (beforeJson.disclaimer !== afterJson.disclaimer) {
    return fail(name, 'contributor changed the disclaimer text');
  }
  return ok(name);
}

/**
 * scope item 2: "source domain on an allowlist of government/agency
 * domains ... seeded from the rulesets' existing sources". Checks every
 * `sources[]` entry in the submitted file (new or pre-existing) resolves
 * to an allowlisted domain — a pre-existing entry is always allowlisted by
 * construction (AC2 generates the list FROM the current rulesets), so this
 * only ever actually constrains a genuinely new or edited entry.
 */
export function checkSourceDomainAllowlist(afterJson, allowlist) {
  const name = 'source-domain-allowlist';
  if (afterJson === null || typeof afterJson !== 'object' || !Array.isArray(afterJson.sources)) {
    return skip(name);
  }
  const offAllowlist = [];
  for (const source of afterJson.sources) {
    const url = typeof source?.url === 'string' ? source.url : null;
    if (!url) continue;
    let domain = null;
    try {
      domain = new URL(url).hostname.toLowerCase();
    } catch {
      offAllowlist.push(`${url} (unparseable URL)`);
      continue;
    }
    if (!allowlist.includes(domain)) {
      offAllowlist.push(`${url} (domain '${domain}' not on the allowlist)`);
    }
  }
  if (offAllowlist.length > 0) {
    return fail(name, `source(s) off the domain allowlist: ${offAllowlist.join('; ')}`);
  }
  return ok(name);
}

function daysBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

// Codex review, PR #1803 round 2, P1 "Reject retrieval dates in the
// future": a `retrieved_at` in the future (a contributor claiming they
// checked a source tomorrow) previously passed the freshness check —
// `daysBetween` takes an ABSOLUTE difference, so a date 26 days in the
// future is exactly as "fresh" as one 26 days in the past under the old
// check. A source can only ever have been retrieved on or before `now`;
// this is checked FIRST, before the freshness window even applies.
function isFreshRetrievedAt(parsed, now) {
  if (!parsed || Number.isNaN(parsed.getTime())) return false;
  if (parsed.getTime() > now.getTime()) return false; // never in the future
  return daysBetween(now, parsed) <= SOURCE_FRESHNESS_DAYS;
}

/** Identity for a requirement row (by `key`) or a manual_checklist row (by `title` — the schema has no key field there, same convention changelog.mjs's diffCorridorRecord already uses). */
function rowsById(rows, idField) {
  const map = new Map();
  for (const row of rows ?? []) {
    const id = row?.[idField];
    if (typeof id === 'string') map.set(id, row);
  }
  return map;
}

function changedOrAddedRows(beforeRows, afterRows, idField) {
  const beforeById = rowsById(beforeRows, idField);
  const afterById = rowsById(afterRows, idField);
  const changed = [];
  for (const [id, afterRow] of afterById) {
    const beforeRow = beforeById.get(id);
    if (beforeRow === undefined || JSON.stringify(beforeRow) !== JSON.stringify(afterRow)) {
      changed.push({ id, row: afterRow });
    }
  }
  return changed;
}

// Codex review, PR #1803 round 1, P1 [Data loss/corruption] "Validate
// removed requirement rows": a row present in `beforeRows` but ABSENT from
// `afterRows` (deleted outright) never appeared in `changedOrAddedRows`
// above (which only ever walks `afterById`), so deleting a requirement or
// manual_checklist item carried zero provenance obligation at all — a
// contributor could silently discard a legal requirement while
// `source-provenance` reported green. Returns the ids of every row removed
// between before and after.
function removedRowIds(beforeRows, afterRows, idField) {
  const beforeById = rowsById(beforeRows, idField);
  const afterById = rowsById(afterRows, idField);
  return [...beforeById.keys()].filter((id) => !afterById.has(id));
}

/**
 * scope item 2: "every changed requirement carries a sources[] entry with
 * retrieved_at within 90 days". A requirement/checklist row's own
 * `sources` field (an array of URL strings — see
 * apps/landing/lib/corridors/types.ts CorridorTargetStateFields) must be
 * non-empty, and every URL in it must match a top-level `sources[]` entry
 * (by url) with a parseable `retrieved_at` no older than
 * SOURCE_FRESHNESS_DAYS. When `beforeJson` is undefined (a brand-new
 * corridor file), every requirement/checklist row is treated as "changed"
 * — a new corridor has nothing else to source it from.
 */
export function checkSourceProvenance(beforeJson, afterJson, { now = new Date() } = {}) {
  const name = 'source-provenance';
  if (afterJson === null || typeof afterJson !== 'object') return skip(name);

  const changedRequirements =
    beforeJson === undefined
      ? (afterJson.requirements ?? []).map((row) => ({ id: row.key, row }))
      : changedOrAddedRows(beforeJson.requirements, afterJson.requirements, 'key');
  const changedChecklist =
    beforeJson === undefined
      ? (afterJson.manual_checklist ?? []).map((row) => ({ id: row.title, row }))
      : changedOrAddedRows(beforeJson.manual_checklist, afterJson.manual_checklist, 'title');

  const changedItems = [...changedRequirements.map((c) => ({ ...c, kind: 'requirement' })), ...changedChecklist.map((c) => ({ ...c, kind: 'manual_checklist item' }))];

  const topLevelSourcesByUrl = new Map();
  for (const source of Array.isArray(afterJson.sources) ? afterJson.sources : []) {
    if (typeof source?.url === 'string') topLevelSourcesByUrl.set(source.url, source);
  }

  const problems = [];

  // Codex review, PR #1803 round 1, P1 [Data loss/corruption] "Validate
  // removed requirement rows": a row DELETED outright (present in before,
  // absent from after) carries no `row.sources` to check against (the row
  // itself is gone), so it cannot be validated the same way an added/
  // changed row is. What CAN be required: the removal is accompanied by at
  // least one fresh (within SOURCE_FRESHNESS_DAYS), newly-added top-level
  // source in this same file — some citation justifying why the
  // requirement no longer applies, rather than a bare, unexplained
  // deletion. (checkSourceDomainAllowlist separately constrains every
  // top-level source's domain; this check only adds the freshness/
  // "actually new" requirement for the removal case.)
  if (beforeJson !== undefined) {
    const removedRequirementIds = removedRowIds(beforeJson.requirements, afterJson.requirements, 'key');
    const removedChecklistIds = removedRowIds(beforeJson.manual_checklist, afterJson.manual_checklist, 'title');
    const removedIds = [
      ...removedRequirementIds.map((id) => ({ id, kind: 'requirement' })),
      ...removedChecklistIds.map((id) => ({ id, kind: 'manual_checklist item' })),
    ];
    if (removedIds.length > 0) {
      const beforeSourceUrls = new Set((Array.isArray(beforeJson.sources) ? beforeJson.sources : []).map((s) => s?.url));
      const freshNewSource = (Array.isArray(afterJson.sources) ? afterJson.sources : []).find((source) => {
        if (typeof source?.url !== 'string' || beforeSourceUrls.has(source.url)) return false; // must be NEW to this PR, not pre-existing
        const parsed = typeof source.retrieved_at === 'string' ? new Date(source.retrieved_at) : null;
        return isFreshRetrievedAt(parsed, now);
      });
      if (!freshNewSource) {
        for (const { id, kind } of removedIds) {
          problems.push(`removed ${kind} '${id}': no fresh (<=${SOURCE_FRESHNESS_DAYS}-day), newly-added source in this file's sources[] justifies the removal`);
        }
      }
    }
  }

  for (const { id, row, kind } of changedItems) {
    const urls = Array.isArray(row?.sources) ? row.sources : [];
    if (urls.length === 0) {
      problems.push(`${kind} '${id}': no sources[] entry`);
      continue;
    }
    for (const url of urls) {
      const source = topLevelSourcesByUrl.get(url);
      if (!source) {
        problems.push(`${kind} '${id}': cites '${url}', which is not in this file's top-level sources[]`);
        continue;
      }
      const retrievedAt = source.retrieved_at;
      const parsed = typeof retrievedAt === 'string' ? new Date(retrievedAt) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        problems.push(`${kind} '${id}': source '${url}' has no valid retrieved_at`);
        continue;
      }
      if (parsed.getTime() > now.getTime()) {
        problems.push(`${kind} '${id}': source '${url}' retrieved_at ${retrievedAt} is in the future (a source cannot be retrieved after now)`);
        continue;
      }
      const ageDays = daysBetween(now, parsed);
      if (ageDays > SOURCE_FRESHNESS_DAYS) {
        problems.push(`${kind} '${id}': source '${url}' retrieved_at ${retrievedAt} is ${Math.floor(ageDays)} days old (>${SOURCE_FRESHNESS_DAYS})`);
      }
    }
  }

  if (problems.length > 0) {
    return fail(name, problems.join('; '));
  }
  return ok(name);
}

/** Runs every content check that needs exactly one changed corridors/<slug>.json file; returns `skip`-shaped results for all of them when the scope check itself already failed. */
export function runContentChecks(changeset, { allowlist, now } = {}) {
  if (!hasSingleCorridorChange(changeset)) {
    return [
      skip('schema-shape'),
      skip('canonical-formatting'),
      skip('protected-fields'),
      skip('disclaimer-unchanged'),
      skip('source-domain-allowlist'),
      skip('source-provenance'),
    ];
  }
  const path = changeset.changedPaths[0];
  const beforeRaw = changeset.baseFiles.get(path);
  const afterRaw = changeset.headFiles.get(path);
  const before = beforeRaw === undefined ? undefined : safeParse(beforeRaw);
  const after = safeParse(afterRaw);

  return [
    checkSchemaShape(after),
    checkCanonicalFormatting(afterRaw, after),
    checkProtectedFields(before, after),
    checkDisclaimerUnchanged(before, after),
    checkSourceDomainAllowlist(after, allowlist ?? []),
    checkSourceProvenance(before, after, { now }),
  ];
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
