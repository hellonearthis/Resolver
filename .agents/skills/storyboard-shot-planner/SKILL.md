---
name: storyboard-shot-planner
description: Transforms storyboard frames, concept stills, and reference images into director-level shot breakdowns and image-to-video prompts for MiniMax Hailuo H3 and Gemini Omni 1.1 Flash.
---
# Storyboard Shot Planner

Converts one still image into a director-level shot breakdown, then compiles that breakdown into
prompts formatted for the two target models: **MiniMax Hailuo H3** and **Gemini Omni 1.1 Flash**.
Each model reads structure differently, so the final prompts are written separately, not shared.

## Workflow

1. **Look at the image closely.** Don't guess from a thumbnail impression — actually read subject
   position, framing, lighting direction, depth, and any implied motion already frozen in the
   frame (hair mid-flip, fabric mid-swing, weight shifted onto one foot, etc.). Those are free
   motion cues.
2. **Fill out the Scene Read** (below) before writing any prompt text. This is the thinking step —
   it's fine to show it to the user as the "breakdown," since that's the structured half of the
   output they want.
3. **Always propose camera + motion.** Never leave a shot static by default — decide what moves
   (camera, subject, environment, or a combination) and why it serves the moment. If genuinely
   nothing should move, say so explicitly as a deliberate choice, not an omission.
4. **Compile two final prompts** — one in Hailuo H3 conventions, one in Gemini Omni 1.1 Flash
   conventions — using the templates below. These are the ready-to-paste half of the output.
5. **Present both halves together**: Scene Read + Camera/Motion plan first, then the two prompts
   in clearly labeled blocks the user can copy straight into either tool.

## Scene Read (structured breakdown)

Work through these fields for the uploaded image:

- **Subject** — who/what, key identity details that must survive into video (face, outfit, colors,
  distinguishing features).
- **Setting** — location, time of day, weather/atmosphere, background elements.
- **Composition** — shot size (close-up / medium / wide), angle, framing, where the eye lands first.
- **Lighting** — direction, quality (hard/soft), color temperature, key light source.
- **Mood / story beat** — what emotional moment this frame is caught inside of. Where useful, note
  what's just off-frame or about to happen that would naturally shift or interrupt the moment
  (an arrival, a change in weather, someone speaking) — this is what gives the clip somewhere to
  go rather than just idling.
- **Frozen motion cues** — anything already implied mid-motion in the still (see step 1).

## Camera & Motion Plan

- **Camera movement** — name it plainly: static/locked, slow push-in, pull-out, pan (direction),
  tilt, orbit, handheld drift, tracking/follow. Pick one primary movement; a secondary micro-move
  (subtle parallax, slight drift) is fine but don't stack multiple big moves in a single 4–15s clip.
- **Speed** — slow/subtle vs. fast/energetic — should match the mood beat above.
- **Subject motion** — what the subject does across the clip (small continuous action reads far
  better than a big pose-to-pose change in this duration).
- **Environmental/secondary motion** — wind, hair, fabric, light shift, particles, water, smoke,
  background life. This is what sells realism even when the camera is static.
- **Duration** — recommend a clip length (both models support ~4–15s). Shorter (4–6s) for a single
  clean beat; longer (8–12s) only if there's a real start → change → end arc.
- **Continuity constraints** — what must stay locked across the whole clip (identity, wardrobe,
  color palette, environment layout, style/medium if the image is illustrated/anime/painterly).
- **Battle & Multi-Character Continuity (Zero Spatial Cheating)** — when planning action scenes:
  - *Environmental Anchor:* Anchor shots to a recognizable landmark (e.g., a massive transmission tower, wrecked vehicle) rather than generic open terrain to keep spatial orientation clear.
  - *Vector/Pawn Tracking:* Strictly maintain character screen directions and compass positions (e.g., Character A always advancing from screen-left/west). If Character B faces west, Character A must appear in their line of sight.
  - *Background Persistence:* If secondary characters or drones suffer damage or perform actions in the background, ensure their physical state persists across subsequent angles (e.g. wandering with lodged debris or repairing damage).

## Final Prompt Templates

### MiniMax Hailuo H3

H3 responds best to a compact production-brief structure. Write it as flowing prose (not literal
labeled fields unless the user wants the verbose form), covering, in order:
**opening state → action/timeline → camera → sound → constraints.**

Plain-language pattern (default, works for most single-shot cases):
```
[Subject + identity], in [setting/time/atmosphere]. [Action in chronological order,
ending on a clear final state]. [Camera movement, scale, speed]. [Ambience/sound —
diegetic sound, and music or "no music" if relevant]. Keep [identity/wardrobe/palette/
environment] consistent throughout.
```

If the user is animating this exact reference image (image-to-video / first-frame mode), add a
frame-anchor line at the top:
```
For the target video, at 0.00 seconds the reference image is fully referenced — preserve its
subject, composition, wardrobe, environment, and visual arrangement as the starting frame.
```

Keep it to one clean paragraph per shot. Split into multiple prompts/clips only if the idea needs
more than ~15 seconds, changes location, or needs an unrelated camera style — call this out to the
user rather than cramming it into one prompt.

### Gemini Omni 1.1 Flash

Omni reads best as a 5-part instruction, since it treats the image as an editable/animatable input
rather than a strict frame anchor. Write it as short, direct sentences:

```
Goal: [what this clip should become / the point of the shot]
Input role: Use the attached image as [the starting frame / style & subject reference — 
  be explicit about how literally to follow it]
Scene: [setting, atmosphere, what's visible]
Motion: [camera movement] + [subject motion] + [secondary/environmental motion]
Constraints: Keep [identity/wardrobe/palette/style] unchanged. No [anything to exclude —
  Omni has no separate negative-prompt field, so exclusions go here in plain language].
```

Omni supports conversational follow-up edits — mention to the user that if the first result is
close but not right, they can just describe the fix in plain language ("make the pan slower,"
"remove the extra person in the background") rather than rewriting the whole prompt.

## Output format

Always give the user, in this order:
1. A short Scene Read (bullet form, using the fields above — skip any that add nothing).
2. Camera & Motion Plan (bullet form).
3. Two labeled, copy-ready prompt blocks: **"Hailuo H3 prompt"** and **"Omni 1.1 prompt."**

Don't pad the write-up with restated obvious details from the image — the breakdown should read
like notes a director would actually jot down, not a full re-description of the picture.

## Notes

- If the user only wants one of the two target models for a given shot, still build the full Scene
  Read / Camera plan, but only compile the one prompt they need.
- If the image is part of a larger sequence the user is planning, flag continuity items (palette,
  wardrobe, environment) that should carry forward to the next frame's prompt — but don't invent
  the next shot unless asked.
- These two models move fast; if the user mentions a detail that contradicts something above
  (e.g. a newer duration cap, a new prompt field), trust what they tell you over this file.
