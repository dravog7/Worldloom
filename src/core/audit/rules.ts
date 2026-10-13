import type { IndexProvider } from "../index/provider";
import type { Note, Temporal } from "../types";
import { contentHash } from "../vault/hash";

/**
 * M2 Wave B3 (PLAN-M2): the offline deterministic rules auditor.
 *
 * Given an IndexProvider snapshot, produces structural continuity findings —
 * no network, no AI, no randomness (ADR-004 §2). The four rules:
 *
 * 1. duplicate-alias         — one name (title or alias) claimed by multiple notes
 * 2. missing-relation-target — a frontmatter relation pointing at no note
 * 3. temporal-overlap        — two notes sharing a name with provably overlapping
 *                              eras, or one note with an inverted numeric range
 * 4. dead-link               — a [[wikilink]] no note resolves
 *
 * Determinism & identity contract (D1 tombstones rely on it):
 * - `id` = content hash of (kind, noteA, quoteA, noteB, quoteB). Line numbers
 *   are deliberately EXCLUDED so dismissals survive edits that merely shift
 *   lines; quotes/paths are the finding's identity, lines are locators.
 * - Output order is canonical (kind rule order → noteA → lineA → noteB → id),
 *   independent of provider iteration order.
 *
 * Resolution mirrors MemoryIndex.resolveTarget: exact path, path + ".md",
 * then case-insensitive title / alias / filename-stem (ADR-002: filename is
 * identity; the smoke suite documents stem resolution for em-dash H1s).
 *
 * `lineA`/`lineB` are 0-based for wikilinks; -1 means the finding is about
 * frontmatter, whose source line the index snapshot does not carry (same
 * -1 convention as DerivedEdge relations). Quotes always carry the exact
 * offending token so the UI has quoted evidence even without a line.
 */

export type FindingKind =
  | "duplicate-alias"
  | "missing-relation-target"
  | "temporal-overlap"
  | "dead-link";

/** One deterministic rules finding (PLAN-M2 B3 shape, frozen for D1/D2). */
export interface Finding {
  /** contentHash of kind+notes+quotes; stable across runs and line shifts. */
  id: string;
  kind: FindingKind;
  noteA: string;
  lineA: number;
  quoteA: string;
  noteB?: string;
  lineB?: number;
  quoteB?: string;
  message: string;
}

const KIND_ORDER: Record<FindingKind, number> = {
  "duplicate-alias": 0,
  "missing-relation-target": 1,
  "temporal-overlap": 2,
  "dead-link": 3,
};

const SEPARATOR = "\u0000";

/** Audits one provider snapshot; pure, deterministic, offline. */
export function auditRules(provider: IndexProvider): Finding[] {
  const notes = [...provider.all()].sort((a, b) => cmp(a.path, b.path));
  const resolver = buildResolver(notes);
  const findings = [
    ...findDuplicateAliases(notes),
    ...findMissingRelationTargets(notes, resolver),
    ...findTemporalOverlaps(notes),
    ...findDeadLinks(notes, resolver),
  ];
  return findings.sort(compareFindings);
}

/* ------------------------------------------------------------------ */
/* Rule 1 — duplicate alias → multiple targets                         */
/* ------------------------------------------------------------------ */

function findDuplicateAliases(notes: Note[]): Finding[] {
  const ownersByName = collectNameOwners(notes);
  const findings: Finding[] = [];
  for (const [name, group] of ownersByName) {
    for (let i = 0; i < group.owners.length; i++) {
      for (let j = i + 1; j < group.owners.length; j++) {
        const noteA = group.owners[i] as Note;
        const noteB = group.owners[j] as Note;
        findings.push(
          makeFinding({
            kind: "duplicate-alias",
            noteA: noteA.path,
            lineA: -1,
            quoteA: claimForm(noteA, name),
            noteB: noteB.path,
            lineB: -1,
            quoteB: claimForm(noteB, name),
            message: `"${group.display}" is claimed by ${noteA.path} and ${noteB.path} — wikilinks to it are ambiguous.`,
          }),
        );
      }
    }
  }
  return findings;
}

/** name (lowercase) → owners (sorted by path) + the first declared casing. */
function collectNameOwners(
  notes: Note[],
): Map<string, { display: string; owners: Note[] }> {
  const owners = new Map<string, Map<string, Note>>();
  const displays = new Map<string, string>();
  for (const note of notes) {
    for (const declared of [note.title, ...note.aliases]) {
      const name = normalizeName(declared);
      if (name === "") continue;
      if (!displays.has(name)) displays.set(name, declared.trim());
      let byPath = owners.get(name);
      if (!byPath) {
        byPath = new Map();
        owners.set(name, byPath);
      }
      // One owner per note even when it repeats the name in title AND aliases.
      if (!byPath.has(note.path)) byPath.set(note.path, note);
    }
  }
  const sorted = new Map<string, { display: string; owners: Note[] }>();
  for (const name of [...owners.keys()].sort(cmp)) {
    const byPath = owners.get(name) as Map<string, Note>;
    sorted.set(name, {
      display: displays.get(name) ?? name,
      owners: [...byPath.values()].sort((a, b) => cmp(a.path, b.path)),
    });
  }
  return sorted;
}

/** How a note declares `name`: alias preferred over title, original casing kept. */
function claimForm(note: Note, name: string): string {
  const alias = note.aliases.find((a) => normalizeName(a) === name);
  if (alias !== undefined) return `alias "${alias}"`;
  return `title "${note.title}"`;
}

/* ------------------------------------------------------------------ */
/* Rule 2 — relation target missing                                    */
/* ------------------------------------------------------------------ */

function findMissingRelationTargets(
  notes: Note[],
  resolver: Resolver,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    for (const relation of note.relations) {
      if (resolver.resolves(relation.target)) continue;
      const key = `${note.path}\u0000${relation.kind}\u0000${relation.target}`;
      if (seen.has(key)) continue; // identical duplicate lines = one finding
      seen.add(key);
      findings.push(
        makeFinding({
          kind: "missing-relation-target",
          noteA: note.path,
          lineA: -1,
          quoteA: `${relation.kind} → "${relation.target}"`,
          message: `Relation "${relation.kind}" targets "${relation.target}", but no note in the vault matches.`,
        }),
      );
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Rule 3 — temporal overlap conflicts                                 */
/* ------------------------------------------------------------------ */

/** Comparable interval over numeric era labels ("Session 3" → 3). */
interface NumericInterval {
  lo: number;
  hi: number;
}

/** Non-numeric era labels — comparable only by (case-insensitive) identity. */
interface LabelSpan {
  labels: string[];
}

function findTemporalOverlaps(notes: Note[]): Finding[] {
  const findings: Finding[] = [];

  // 3a. Inverted numeric range: from after to, on the owning note alone.
  for (const note of notes) {
    if (note.temporal?.from === undefined || note.temporal.to === undefined) {
      continue;
    }
    const from = numberIn(note.temporal.from);
    const to = numberIn(note.temporal.to);
    if (from === undefined || to === undefined || from <= to) {
      continue;
    }
    findings.push(
      makeFinding({
        kind: "temporal-overlap",
        noteA: note.path,
        lineA: -1,
        quoteA: temporalQuote(note.temporal),
        message: `Inverted temporal range in ${note.path}: from "${note.temporal.from}" is after to "${note.temporal.to}".`,
      }),
    );
  }

  // 3b. Two notes sharing a name with provably overlapping eras. At most one
  // finding per note pair (first colliding name in name order carries it).
  const ownersByName = collectNameOwners(notes);
  const emittedPairs = new Set<string>();
  for (const group of ownersByName.values()) {
    for (let i = 0; i < group.owners.length; i++) {
      for (let j = i + 1; j < group.owners.length; j++) {
        const noteA = group.owners[i] as Note;
        const noteB = group.owners[j] as Note;
        const pairKey = `${noteA.path}\u0000${noteB.path}`;
        if (emittedPairs.has(pairKey)) continue;
        if (!temporallyOverlap(noteA.temporal, noteB.temporal)) continue;
        emittedPairs.add(pairKey);
        const a = noteA.temporal as Temporal;
        const b = noteB.temporal as Temporal;
        findings.push(
          makeFinding({
            kind: "temporal-overlap",
            noteA: noteA.path,
            lineA: -1,
            quoteA: temporalQuote(a),
            noteB: noteB.path,
            lineB: -1,
            quoteB: temporalQuote(b),
            message: `"${group.display}" is claimed by ${noteA.path} and ${noteB.path}, whose eras overlap.`,
          }),
        );
      }
    }
  }
  return findings;
}

function temporallyOverlap(a?: Temporal, b?: Temporal): boolean {
  if (a === undefined || b === undefined) return false;
  const intervalA = numericInterval(a);
  const intervalB = numericInterval(b);
  if (intervalA !== null && intervalB !== null) {
    return Math.max(intervalA.lo, intervalB.lo) <= Math.min(intervalA.hi, intervalB.hi);
  }
  const spanA = labelSpan(a);
  const spanB = labelSpan(b);
  if (spanA !== null && spanB !== null) {
    return spanA.labels.some((label) => spanB.labels.includes(label));
  }
  // Numeric vs free-form label: not provably comparable — never flag.
  return false;
}

/**
 * Both bounds numeric → [min, max]. Single numeric bound → point interval
 * (the label denotes one unit). Any free-form label → null (see labelSpan).
 */
function numericInterval(temporal?: Temporal): NumericInterval | null {
  if (temporal === undefined) return null;
  const from = temporal.from === undefined ? undefined : numberIn(temporal.from);
  const to = temporal.to === undefined ? undefined : numberIn(temporal.to);
  if (from === undefined && to === undefined) return null;
  const lo = from ?? (to as number);
  const hi = to ?? (from as number);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

function labelSpan(temporal?: Temporal): LabelSpan | null {
  if (temporal === undefined) return null;
  const labels: string[] = [];
  for (const bound of [temporal.from, temporal.to]) {
    if (bound === undefined) continue;
    if (numberIn(bound) !== undefined) return null; // mixed numeric/free-form
    labels.push(normalizeName(bound));
  }
  return labels.length > 0 ? { labels } : null;
}

function numberIn(label: string): number | undefined {
  const match = /-?\d+/u.exec(label);
  return match === null ? undefined : Number(match[0]);
}

function temporalQuote(temporal: Temporal): string {
  const from = temporal.from === undefined ? "" : ` from "${temporal.from}"`;
  const to = temporal.to === undefined ? "" : ` to "${temporal.to}"`;
  return `temporal:${from}${to}`;
}

/* ------------------------------------------------------------------ */
/* Rule 4 — dead wikilinks                                             */
/* ------------------------------------------------------------------ */

function findDeadLinks(notes: Note[], resolver: Resolver): Finding[] {
  const findings: Finding[] = [];
  for (const note of notes) {
    const seen = new Set<string>();
    for (const link of note.links) {
      const target = link.target.trim();
      if (target === "") continue;
      const key = target.toLowerCase();
      if (seen.has(key)) continue; // repeated dead target = one finding
      seen.add(key);
      if (resolver.resolves(target)) continue;
      findings.push(
        makeFinding({
          kind: "dead-link",
          noteA: note.path,
          lineA: link.line,
          quoteA:
            link.display === undefined
              ? `[[${target}]]`
              : `[[${target}|${link.display}]]`,
          message: `Link target "${target}" matches no note in the vault.`,
        }),
      );
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Resolution, hashing, ordering                                       */
/* ------------------------------------------------------------------ */

interface Resolver {
  resolves(target: string): boolean;
}

/** Exact path → path + ".md" → case-insensitive title/alias/stem (MemoryIndex parity). */
function buildResolver(notes: Note[]): Resolver {
  const paths = new Set<string>();
  const names = new Set<string>();
  for (const note of notes) {
    paths.add(note.path);
    const base = note.path.split("/").pop() ?? note.path;
    const stem = base.replace(/\.md$/iu, "");
    for (const name of [note.title, ...note.aliases, stem]) {
      const normalized = normalizeName(name);
      if (normalized !== "") names.add(normalized);
    }
  }
  return {
    resolves(target: string): boolean {
      const trimmed = target.trim();
      if (paths.has(trimmed)) return true;
      const withExtension = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      if (paths.has(withExtension)) return true;
      return names.has(normalizeName(trimmed));
    },
  };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function makeFinding(
  core: Omit<Finding, "id"> & { noteB?: string; quoteB?: string },
): Finding {
  const id = contentHash(
    [
      core.kind,
      core.noteA,
      core.quoteA,
      core.noteB ?? "",
      core.quoteB ?? "",
    ].join(SEPARATOR),
  );
  return { id, ...core };
}

function compareFindings(a: Finding, b: Finding): number {
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    cmp(a.noteA, b.noteA) ||
    a.lineA - b.lineA ||
    cmp(a.noteB ?? "", b.noteB ?? "") ||
    cmp(a.id, b.id)
  );
}

/** Locale-independent codepoint comparison (hash/order stability). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
