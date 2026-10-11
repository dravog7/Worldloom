# Fixtures

## vault-sample/ — the Wave A fixture vault

A small fantasy TTRPG campaign vault ("The Ashen Crown") used by tests,
smoke scripts, and auditor demos. It is a plain folder of markdown notes —
exactly the shape ADR-002 declares as the source of truth.

**Contract (keep these properties intact):**

- 33 notes across `characters/`, `places/`, `events/`, `factions/`,
  `items/`, `concepts/`, `sessions/`, `campaigns/`.
- Every note uses the frontmatter v1 schema from ADR-002
  (`type`, `aliases`, `tags`, `relations[{kind,target}]`, `temporal`).
- 200+ `[[wikilinks]]`, including pipe form `[[Target|display]]` (23 of them).
- Exactly **4 unresolved link targets** (dangling by design):
  - `[[Mira's Locket]]` (Mira.md)
  - `[[Order of the Pale Hand]]` (Aelindra.md, Session 01)
  - `[[The Weeping Gate]]` (Session 06)
  - `[[Vault of Whispers]]` (Dunmarrow Keep.md, campaign index)
- Exactly **one deliberate factual contradiction** for auditor demos:
  Aelindra's eye colour is **grey-green** in `characters/Aelindra.md` and
  **storm-blue** in `characters/Sereth Vane.md`. Do not "fix" it.

**Fixing the typo/possessive links?** They were already repaired once; do
not reintroduce `[[Possessive's]]`-style links (write `[[Title]]'s`
instead) and never hard-wrap a `[[wikilink]]` across a line break — the
parser spec (B1) scans line-wise.
