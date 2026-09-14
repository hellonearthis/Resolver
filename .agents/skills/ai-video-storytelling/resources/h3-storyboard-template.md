# H3 Storyboard Template — Acting-Note Edition

A shot-planning template that doubles as your H3 prompt draft. Fill it out per shot, then the "H3 Prompt Draft" row is close to copy-paste ready.

---

## 0. Character Reference Sheet (fill once per character)

| Field | Value |
|---|---|
| Character name / role | |
| Face / build (locked description) | |
| Wardrobe (locked description) | |
| Default lighting signature | |
| Reference image role(s) | e.g. "identity", "style", "voice" |
| Voice reference (if any) | |

> Reuse this block verbatim across every shot's prompt. This is what stops the model reinventing the character each generation.

---

## 1. Emotional Beat Map (fill once per sequence)

| Section (intro/verse/drop/etc) | Emotion | Tension (1-5) | Pace | Visual signature (concrete, not adjectives) |
|---|---|---|---|---|
| | | | | e.g. downward gaze, slow blink, desaturated, static cam |
| | | | | |
| | | | | |

---

## 2. Per-Shot Panel

Copy this block for each shot (H3 clips run ~5-15s, one readable event each — don't cram multiple beats into one panel).

### Shot [#] — [working title]

| Field | Notes |
|---|---|
| **Time window** | `[00:00.000–00:05.000]` (H3 timestamp format) |
| **Reference(s) used** | Which images/video, and their **role** (identity / style / motion / voice) |
| **Camera** | Angle, movement, static or handheld — one clear path |
| **Action (main event)** | Active verb + direction + speed. Not "walks" → "strides toward camera, coat swaying" |
| **Acting note** | Micro-expression / gaze direction / tension level / pace (pulled from your Emotional Beat Map) |
| **Dialogue (if any)** | `<d>[English] line here</d>` |
| **Sound / ambient** | Diegetic sound, music cue, silence |
| **Style lock** | One style descriptor, consistent across shots — no "high quality/4K" filler |

**H3 Prompt Draft:**
```
[00:00.000–00:05.000] <Camera> establishing description. <Character reference block>
performs <action>, <acting note translated into visible behavior>.
<d>[English] <dialogue if any></d>
<style lock> lighting/tone.
```

---

## 3. Sequence Checklist (before generating)

- [ ] Character Bible block is identical across all shots in the sequence
- [ ] No adjectives in the action or acting note fields — only visible behaviors
- [ ] Every shot has a style lock line matching the rest of the sequence
- [ ] Timestamps don't overlap across shots
