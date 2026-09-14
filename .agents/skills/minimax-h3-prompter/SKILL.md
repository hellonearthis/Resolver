---
name: minimax-h3-prompter
description: Generates highly detailed MiniMax H3 multimodal prompts using the 5-Block, 8-Part Playbook, Grounded Micro-Beat, or Ref2VA Inpainting/Video Editing frameworks for video, audio, and reference asset direction.
---

# MiniMax H3 Prompt Engineer — Multimodal Production Brief Engine

When writing prompts for **MiniMax H3**, you are acting as a Director & Technical Producer. MiniMax H3 is a unified multimodal model that processes text, images, video, and audio in a single context pass. It rewards prompts structured as **detailed production paperwork or director's briefs** over simple conversational captions.

---

## 1. Operating Frameworks

You support five structural frameworks. Infer the best framework or ask the user:

### Framework 1: The 5-Block Structure (Creative Brief Mode)
Ideal for standard, rapid creative briefs across any custom duration:
1. **Roles (Reference Job Assignments):** Zero-indexed upload order (`Image 1`, `Image 2`, `Video 1`, `Audio 1`) or explicit tags (`<Picture 1>`, `<Video 1>`, `<Audio 1>`).
2. **Beats (Event-Driven Shot Sequence):** Block sequentially using relative progress or physical triggers (e.g., `[Beat 1: The Approach] ... [Beat 2: The Physical Turn] ... [Beat 3: The Departure]`). Never use clock timecodes (`At 00:10:00`, `From 00:12:00`).
3. **Look (Aesthetics, Lighting, & Film Language):** Camera moves, lens choice, color grading, exposure breathing, film texture.
4. **Sound (Dialogue, SFX, & Music):** Room tone, dialogue (lip-synced natively), SFX, musical instruments mapped to relative action cues.
5. **Limits (Constraints & Negatives):** What must remain stable and what must not appear.

---

### Framework 2: The 8-Part Playbook Structure (Cinematic Scripting Mode — Default)
Ideal for high-fidelity, production-grade cinematic scripting across any generation length:
1. **Reference Job Assignments:** Map out attached assets explicitly (`Image 1 is lead character Mei: maintain facial geometry and attire...`).
2. **Scene / Format / Mood:** Establish environment, genre, time of day, and aesthetic tone.
3. **One Dominant Action:** **CRITICAL TECHNICAL RULE:** Restrict clip to *one* primary physical action/motion to prevent visual warping and physical collapse.
4. **Camera Path & Framing:** Natural cinematographic vocabulary (*slow push in, rack focus, orbit, dolly zoom, Dutch tilt*). **NO bracketed parameter syntax** like `[Push in: 2s]`. Use fluent sentences.
5. **Lighting & Palette:** Direct light sources, color temperatures, reflections, depth of field.
6. **Sound Clause:** Native stereo track detailing dialogue (must be in quotes, e.g. `"spoken"`), environment SFX, and musical cues mapped to relative action cues (e.g. `[On impact]`, `[During camera push]`).
7. **Final Beat / Composition:** Camera resting point and final frame layout.
8. **Negative Directions:** Boundaries preventing morphing, extra limbs, garbled text, or unintended animation styling.

---

### Framework 3: Cinematic AI Director Sheet (Reference Asset Generation)
Ideal for helping the user generate a comprehensive visual reference image *before* writing the final H3 prompt. 
When the user needs a robust first-frame reference (for I2VA or FL2VA modes), use this framework to generate a Text-to-Image prompt for an external image generator (e.g., Midjourney, Flux).
- **Core Output:** A text prompt for an image generator that produces a multi-panel "Director Sheet".
- **Instructions:** You MUST consult `resources/cinematic_director_sheet.txt` for the exact prompt structure and required panels (cinematic keyframe, character refs, motion arrows, lighting diagram, etc.).

---

### Framework 4: Grounded Micro-Beat Cinematic Directing (Ultra-Realistic Single-Shot Mode)
Ideal for hyper-realistic, emotionally intense, single-shot scenes across any duration with complex micro-actions, tactile physics, and naturalistic sound:
1. **Header & Invariance Contract:** Technical specifications (Duration, Aspect Ratio, FPS, Shot Type) and explicit reference locks declaring exact preserved traits and forbidden alterations.
2. **Initial Framing & Ground-Level Vector:** Detailed first-frame state starting from `Image 1` with a single unhurried camera trajectory (no arcing, cuts, or heroic sweeps).
3. **Sequential Chronological Micro-Beats (Event-Driven):** Sequential physical micro-action blocks chained by physical cause-and-effect (e.g., *Beat 1 (Opening contact & grip)* $\to$ *Beat 2 (Perception shift as eyes widen)* $\to$ *Beat 3 (Impact & dialogue delivery)*). Do not use rigid sub-second clock timestamps (`00:00 to 00:03.20`), as diffusion models cannot hit exact clock positions.
4. **Dialogue & Vocal Resonance Clause:** Bracketed vocal description `[Language, age/gender, vocal texture/delivery]` with quoted dialogue and breath dynamics.
5. **Performance Requirements:** Emotional progression through somatic cues (swallowing, breathing, tremors) rather than theatrical over-acting.
6. **Physics & Material Requirements:** Explicit contact grounding, garment wetness/dirt adherence, zero clipping or floating.
7. **Sound & Restrained Score Mix:** Intimate foley layer, dialogue proximity, and strict suppression of music until late beats (forbidding trailer stabs/swells).
8. **Prohibited Directives:** Comprehensive blacklist preventing AI hallucinations, sudden revivals, extra entities, or lighting/color shifts.

*Reference guide and full example available at: `resources/microbeat_grounded_cinematic.md`.*

---

### Framework 5: Video Inpainting & Object Replacement (Ref2VA / LanPaint Workflow)
Ideal for video editing, inpainting, costume swapping, face swapping, or prop replacement using MiniMax H3 Reference-to-Video (`ref2va`) and ComfyUI:

1. **Dual-Input Requirement (CRITICAL):**
   - **Original Video (`ref_video_0` / `<Video 1>`):** The "source plate" supplying base motion, camera trajectory, unmasked physics, and background.
   - **Reference Image (`ref_images.ref_image_0` / `<Picture 1>`):** The style/subject reference defining identity, clothing, or object rendered inside the mask.
   - *Never connect only the image without the source video, or H3 will generate a brand new scene.*
2. **ComfyUI / LanPaint AV Pipeline:**
   - Pipe the source video and mask through `LanPaint_AVEncode` to initialize the latent space.
   - Connect Reference Image to `ref_image_0` and Original Video to `ref_video_0`.
3. **6-Section Inpainting Prompt Format:**
   - **`subject_definitions:`** Establish the **Text-to-Asset Bond** (e.g. `<Subject 1>` is defined by `<Picture 1>`, `<Video 1>` is the source plate).
   - **`summary:`** Tag as `[video editing + reference generation]` detailing the edit.
   - **`retention_analysis:`** Mark `<Subject 1>` as `fully_preserved` and `<Video 1>` as `partially_preserved` (specifying preserved background/motion).
   - **`detailed_description:`** Declare **Substitution-Constraint Pairs** (e.g. "[Shot 1] The camera maintains the exact framing and movement from source <Video 1>. In the masked region, the original character is modified to match <Subject 1> from <Picture 1> while background remains unchanged").
   - **`overall_soundscape:`** Audio retention/mix from source plate or sound effects.
   - **`non_diegetic_music:`** Background score or `N/A`.

*Reference guide, templates, and full breakdown available at: `resources/h3_inpainting_video_editing.md`.*

---

### Framework 6: Motion Spine & Kinetic Match-Cut Engine (H3 Max Motion Mode)
Ideal for seamless continuous motion, typography animations, brand reveals, and stylized match-cut montages across sequential transformations:

1. **Continuous Motion Spine:** Declare a single persistent geometric or kinetic line of action connecting every transition (e.g., *"The motion spine is one continuous smoke line"*, *"The motion spine is one unbroken diagonal brushstroke"*).
2. **Passage Grouping & Camera Laws:** Group clues into structured passages (e.g. 5 passages of 3 clues), assigning exactly one dominant transformation law and one camera behavior per passage (*quiet push, low lateral track, left-to-right follow, fast pullback, locked frontal hold*).
3. **Inheritance Directive:** Explicitly state *"Every transition inherits line, pattern, material, or trajectory from what is already visible."*
4. **Precomposed Typeset Integrity (for text/UI):**
   - *"Render every phrase as one complete professionally typeset precomposed layer."*
   - *"Never construct, scramble, morph, glitch, regenerate, rotate, bend, or animate individual letters."*
   - *"Directional blur only on moving slabs and masks. Zero blur while text is readable."*

*Reference guide and examples available at: `resources/motion_spine_and_kinetic_transitions.md`.*

---

### Framework 7: "80s Broadcast & Somatic Restraint" Lens Profile (Vintage Television Drama Mode)
Ideal for authentic period television (BBC prestige drama, 70s–80s procedural drama, kitchen-sink realism, Cold War thrillers) requiring unhurried human pacing, mechanical zoom optics, and analog broadcast texture:

1. **Stationary Pedestal & True Optical Zoom:**
   - Forbid 3D digital fly-throughs, drone swoops, and floating gimbal moves.
   - Direct a stationary broadcast pedestal camera utilizing motorized parfocal zoom optics:
     - *Prompt Example:* *"The camera body remains physically stationary on a heavy broadcast studio pedestal; a slow, motorized optical zoom creeps imperceptibly from an off-center medium two-shot into a tight close-up (35mm to 95mm focal length shift), compressing background depth and showing subtle optical breathing with zero spatial parallax."*
2. **Sensor & Analog Broadcast Physics:**
   - Specify authentic 1-inch Type C video tape, 576i PAL / 480i NTSC broadcast raster, and soft optical edge rolloff (ban modern high-pass digital sharpening halos).
   - Simulate Plumbicon / Saticon camera tube physics: subtle specular halation / warm bloom around bare practical incandescent bulbs and gentle highlight rolloff.
   - *Negative Guardrail:* Forbid cheesy digital VHS scanline filters, fake tracking static, or rainbow chromatic aberration; demand genuine period broadcast footage.
3. **Tungsten Lighting Architecture:**
   - 3200K tungsten halogen practicals, amber lamp spill, warm bounce off dark wood veneer or laminate tables, and deep velvety tobacco/umber shadows without digital shadow lift.
4. **Somatic Restraint & The Cognitive Latency Beat:**
   - Demand contained, understated acting: clenched masseter jaw, unmoving posture, a slow glottal swallow, or an unblinking gaze held across three seconds of dead air.
   - Audio must prioritize ambient room tone (refrigerator compressor hum, radiator tick) holding the pause between spoken lines.
5. **Anti-Modern Aesthetic Negative Directives:**
   - Always append: *"No modern digital LUT grading, no teal-and-orange split toning, no HDR hyper-contrast, no razor-sharp digital 4K edge-sharpening, no lifted milky blacks, no floating drone/gimbal sweeps, no theatrical over-acting."*

---

## 2. Key Technical Prompting Rules

1. **For Edits, Pair Changes with Constraints (Substitution-Constraint Pairs):**
   - *Example:* "Replace the newspaper with a green hardcover book; keep the armchair, wall textures, and subject's outfit exactly the same."
2. **Explicitly Lock Character Identity:**
   - Describe physical traits explicitly in text (hair length/color, clothing fabric, accessories, skin tone) alongside reference images.
3. **Natural Camera Language Only:**
   - **Allowed:** "The camera slowly pushes in towards her eyes while smoothly racking focus from the wet window pane to her face."
   - **Forbidden:** `[Camera: Push in 2s]` or `[Zoom: 50% / 3s]`.
4. **Zero-Indexed Reference Mapping:**
   - Reference attachments MUST be indexed in chronological upload order (`Image 1`, `Image 2`, `Video 1`, `Audio 1`) or tagged as `<Picture 1>`, `<Picture 2>`, `<Video 1>`, `<Audio 1>`.
5. **Inference & Assembly Settings:**
   - **Prompt Expansion:** Set to **`Disabled`** when submitting structured Playbooks, 6-Section prompts, or Micro-Beats to prevent platform LLMs from hallucinating conflicting adjectives.
   - **Chained Video Trimming:** When splicing multiple generated clips together, trim **1.0 second** from the beginning of downstream clips to eliminate initial diffusion acceleration lag.
6. **Dialogue & Lyrics Notation (Standard Double Quotes ONLY):**
   - **Allowed:** Always enclose spoken dialogue and lyrics in standard double quotes: `<Subject 1> speaks with urgent intensity and says, "Angels are opps."`
   - **Forbidden:** Do NOT use `<d>[Language] ...</d>` or `<d>...</d>` tags. MiniMax H3 renders standard quoted strings natively; `<d>` tags cause tokenization inconsistencies and failed vocal generation.
7. **Shot Duration Ranges vs. Intra-Shot Action Timecodes:**
   - **Standard Shot Range Headers (VALID & SUPPORTED):**
     Standard shot timestamp ranges like `00:00.000–00:05.000 [Shot description]` or multi-shot sequences (`00:00.000–00:03.000 ... 00:03.000–00:06.000`) are the official Hailuo/MiniMax H3 format for allocating shot budgets and setting overall duration. These are fully supported and encouraged for shot planning.
   - **🚫 FORBIDDEN: Intra-Shot Mid-Action Time Events (`'at'` / `'from'`):**
     Injecting actions at a specific time inside a shot using keywords like `'at'` and `'from'` (e.g., `'At 00:08.000, she turns'`, `'From 00:04.000, camera cuts'`, `'at 00:02'`) causes severe timing issues because diffusion models lack an internal sub-second frame clock within an ongoing take.
   - **Allowed (Event-Driven & Cause-and-Effect Phrasing within Shots):**
     - *"As <Subject 1> reaches the edge of the catwalk, the camera cuts to a medium profile view..."*
     - *"Upon releasing the grip, the character stumbles backward against the brick wall..."*
     - *"Midway through the take, the overhead fluorescent light flickers and dims..."*
     - *"In the opening moment...", "Toward the conclusion of the shot..."*
   - **Forbidden:**
     - ❌ *"At 00:08.000, the shot cuts to..."*
     - ❌ *"At 00:03:00, she turns toward the camera."*
     - ❌ *"From 00:04:00, the background begins to dissolve."*
8. **Simulating Physical Lens Filters & Optical Effects:**
   - **Diffusion Transformer Principle:** While MiniMax H3 cannot attach physical glass filters, it renders physical optical behaviors with high precision when prompted with functional descriptions of light interaction, surface reflections, depth of field, and shutter motion blur.
   - **Prompt Formula Structure:**
     `[00:00.000–00:06.000] Subject + Action + Scene + Visual / Lens Style + Camera Movement + Audio`
     *Note:* Use standard shot range headers for total duration. Inside the shot, sequence actions using event-driven cause-and-effect phrasing rather than 'at'/'from' timestamps.
   - **The 6 Core Lens & Filter Profiles:**
     1. *Anamorphic Lens:* `"anamorphic lens, horizontal lens flares, oval bokeh, cinematic widescreen look, streak highlights across bright light sources"`
     2. *Polarizing Filter (CPL):* `"polarizing filter effect, reduced surface reflections, glare-free water and glass, deeply saturated sky and ocean, rich tonal contrast"`
     3. *Neutral Density (ND) Filter:* `"ND filter look, natural shutter motion blur on flowing water and cascades, silky fluid cloud movement in daylight"`
     4. *Vintage / Retro Lens:* `"vintage lens distortion, slight chromatic aberration, soft edge rolloff, warm film grain, 1970s photography tone"`
     5. *Macro Lens:* `"macro photography, extreme close-up, razor-thin shallow depth of field, sharp tactile subject texture, creamy blurred background"`
     6. *Classic Film Stock:* `"shot on 35mm film, organic photochemical color grading, subtle film grain, natural highlight halation and imperfections"`
   - **Key Operational Rules:**
     - *Functional Description over Bare Labels:* Explicitly describe what the filter *physically does* to the frame (e.g. "reduced water reflections and deep azure saturation" instead of merely "polarizing filter").
     - *Pairing with Camera Moves:* Couple the optical effect with camera motion (e.g. "rack focus with anamorphic oval bokeh", "slow tracking shot cutting water glare with a polarizing filter effect").
     - *Non-Conflicting Aesthetics:* Never mix incompatible styles (e.g. avoid combining hyper-clean digital anime with 1970s vintage chromatic aberration).

---

## 3. Validation & Quality Check

Before outputting any MiniMax H3 prompt, you MUST run the Python validator:

```bash
python .agents/skills/minimax-h3-prompter/scripts/validate_h3_prompt.py --input-file <path_to_prompt_md>
```

Fix any warnings (such as bracketed camera syntax, missing sound timestamps, or missing negative directions) before presenting the final brief to the user.

---

## 4. Prompt Formulas & Guides (Resources)

When generating prompts, you should utilize the detailed formulas provided in the `resources/` and `references/` directories to ensure optimal output from the MiniMax H3 model. Specifically:

- For simulating optical lens filters & physical camera glass, consult: `references/lens_filter_simulation_guide.md`
- For prompts involving reference models, consult: `resources/h3 formula for reference model.txt`
- For inpainting, costume swap, or video editing (Ref2VA / LanPaint), consult: `resources/h3_inpainting_video_editing.md`
- For text-to-image or image-to-video prompts, consult: `resources/h3 formula for text2image and image2video.txt`
- For grounded micro-beat single shots, consult: `resources/microbeat_grounded_cinematic.md`
- For cinematic visual reference sheets, consult: `resources/cinematic_director_sheet.txt`

If a task falls into these categories, use `view_file` to read the respective formula document and strictly adhere to its structure and guidelines.
