# Character-Lock Skill Package

A precision identity-locking and dialogue-stabilization engine designed to eradicate attribution errors, swapped actions, vocal bleed, and emotional-arc drift in multi-character AI generation.

## Contents

- **`SKILL.md`**: Core agent skill interface, the 4 Non-Negotiable Laws, enforced line grammar (`SPEAKER` $\to$ `ACTION` $\to$ `LINE`), turn-locking workflow, and critique-mode checklist.
- **`references/character_lock_rules.md`**: Comprehensive 8-section agent rules reference covering the cognitive failure taxonomy, machine-readable ID schema, decoupled state machine emotional engine, turn-locking algorithms, failure troubleshooting, and cross-skill integrations with `micro-drama`, `comedy-tv-writer`, and `ai-video-storytelling`.

## Key Mechanisms

1. **Speaker-Before-Content Ordering:** Overcomes LLM latency by deciding and generating attribution before producing dialogue text.
2. **Machine-Readable ID Schema:** Tagged identity blocks (`[CHAR:ID | name | ref_image | role | voice | current_emotion | arc_stage]`) re-injected dynamically to prevent context degradation.
3. **Reference Image Binding:** Direct grounding to visual assets (`<Picture 1>`, turnaround sheets from `character-reference-sheet`) for somatic actions and automated diffusion prompt compilation.
4. **2-Beat Context Window:** Passes only current and immediately preceding emotional states, preventing the model from rushing toward future arc resolutions.
5. **Turn-Locking:** Isolates individual character generation passes in high-stakes scenes to eliminate cross-character vocal contamination.
