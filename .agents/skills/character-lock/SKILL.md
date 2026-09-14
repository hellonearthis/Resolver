---
name: character-lock
description: Prevents dialogue attribution errors, swapped actions, and voice bleed in multi-character screenplays, prose, and video prompts using strict identity locking and turn isolation.
---
# Character-Lock — Multi-Character Dialogue & Identity Engine

A mechanical agent rules system designed to eliminate dialogue attribution errors, swapped physical actions, vocal homogenization, and emotional-arc drift in multi-character AI generation.

> [!TIP]
> **Token Hygiene & Progressive Disclosure:**
> - Consult `references/character_lock_rules.md` *only* if encountering attribution failures, debugging decoupled state machines, or integrating with external video pipelines.
> - **Output Persistence:** Write multi-character scenes directly to `my_prompts/<scene_slug>.md`. In chat, return the verification status, speaker turn breakdown, and a link to the file to keep working context lightweight.

---

## 🏛️ The 4 Non-Negotiable Laws of Character-Lock

1. **Attribution Precedes Content:** Never generate dialogue or action before assigning the speaker. Models generate emotional content first and backfill attribution, causing line swaps. Attribution must be locked first.
2. **Machine-Readable ID Blocks:** Every active character must have an invariant tag block injected into the active prompt:
   `[CHAR:<SHORT_ID> | name:<Full Name> | ref_image:<path_or_tag> | role:<role> | voice:<3-5 trait words> | current_emotion:<state> | arc_stage:<N of Total>]`
   *(Where `ref_image` points to a turnaround sheet, `<Picture 1>`, or model asset slot).*
3. **The 2-Beat Context Window:** Never feed an entire multi-stage emotional arc into the generation prompt. Feed only the *Current Beat* and the *Previous Beat* to prevent the model from prematurely rushing to the ending.
4. **Active Presence Filtering:** Only include ID blocks for characters physically present in the active beat. Omit off-screen characters to prevent presence hallucinations.

---

## 📝 Enforced Line Grammar

Every dialogue exchange must follow this rigid 3-slot structure:

```text
SPEAKER: [CHAR:<SHORT_ID>]
ACTION: <Concrete physical posture, somatic micro-kinetic, or barrier interaction>
LINE: "<Verbatim dialogue text>"
```

*Never output in freeform script-prose or unlabelled paragraphs.*

---

## 🔄 Turn-Locking Workflow (For High-Stakes Exchanges)

When generating tense arguments, comedy status flips, or rapid-fire banter with 2+ characters:

1. **Step 1 (Speaker A Isolation):** Prompt with only Speaker A's ID block, previous line context, and A's current arc beat.
2. **Step 2 (Generate A):** Output `SPEAKER` $\to$ `ACTION` $\to$ `LINE` for Speaker A.
3. **Step 3 (Freeze & Re-feed):** Freeze A's turn verbatim as read-only context.
4. **Step 4 (Speaker B Isolation):** Prompt with Speaker B's ID block and B's current arc beat, reacting directly to A's output.
5. **Step 5 (Repeat):** Cycle turn-by-turn. Prevents vocal cross-contamination.

---

## 🎯 Critique-Mode Consistency Checklist

Before finalizing any multi-character scene, run this dedicated pass:
- [ ] **Attribution Grammar:** Is every line formatted with `SPEAKER:` at the start?
- [ ] **Voice Trait Match:** Does the diction, sentence length, and vocabulary match the character's `voice` traits?
- [ ] **Arc Fidelity:** Is the character's emotional state aligned strictly with their *current* arc stage, not the scene average?
- [ ] **Presence Audit:** Are all speaking/acting characters physically inside the room threshold?
- [ ] **Role Integrity:** Does each line reinforce the character's structural function (Protagonist, Antagonist, Foil, Catalyst)?

> *If a line fails the audit, regenerate only that specific line—never the whole scene.*
