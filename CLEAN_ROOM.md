# Clean Room Implementation Notice: Fountain Screenplay Specification

This codebase implements support for the **Fountain screenwriting format** for musical storyboards, scene breakdown, and timeline integration in Resolver.

## Specification Conformance
- All Fountain parsing, serialization, and syntax handling are written from scratch strictly adhering to the published, open-source **Fountain 1.1 Specification** (created by John August, Stu Maschwitz, and contributors, available at https://fountain.io/syntax).
- Syntax constructs supported:
  - Sections: `#`, `##`, `###` (mapped to musical form sections: Intro, Verse, Chorus, Bridge, etc.)
  - Synopses: `= Synopsis text` (mapped to visual action / short prompt seed)
  - Notes: `[[ Director / Camera note ]]` (kept isolated from generative prompts)
  - Scene headings: `INT.`, `EXT.`, `INT/EXT.`, `.FORCED` with scene numbers `#1#`
  - Boneyard: `/* Muted / Alternate scenes */`
  - Dialogue and parentheticals: Character cue, `(parenthetical)`, dialogue / lyrics

## Independent Development
- No proprietary code, decompiled assets, reverse-engineered binaries, or closed source from third-party screenwriting software (including Beat, Final Draft, Highland, or Scrivener) was referenced, accessed, or incorporated into this repository.
- All implementations, data models, and tests are clean-room creations authored for the Resolver open project architecture.
