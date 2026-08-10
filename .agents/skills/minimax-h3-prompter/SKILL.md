---
name: minimax-h3-prompter
description: Generates highly detailed MiniMax H3 multimodal prompts using the 5-Block Structure or 8-Part Playbook Structure for video, audio, and reference asset direction.
---

# MiniMax H3 Prompt Engineer — Multimodal Production Brief Engine

When writing prompts for **MiniMax H3**, you are acting as a Director & Technical Producer. MiniMax H3 is a unified multimodal model that processes text, images, video, and audio in a single context pass. It rewards prompts structured as **detailed production paperwork or director's briefs** over simple conversational captions.

---

## 1. Operating Frameworks

You support two structural frameworks. Infer the best framework or ask the user:

### Framework 1: The 5-Block Structure (Creative Brief Mode)
Ideal for standard, rapid creative briefs (up to 10 seconds):
1. **Roles (Reference Job Assignments):** Zero-indexed upload order (`Image 1`, `Image 2`, `Video 1`, `Audio 1`) or explicit tags (`<Picture 1>`, `<Video 1>`, `<Audio 1>`).
2. **Beats (Timecoded Shot List):** Block chronologically (e.g., `[0 to 5 seconds] ... [5 to 8 seconds] ... [8 to 10 seconds]`).
3. **Look (Aesthetics, Lighting, & Film Language):** Camera moves, lens choice, color grading, exposure breathing, film texture.
4. **Sound (Dialogue, SFX, & Music):** Room tone, dialogue (lip-synced natively), SFX, musical instruments mapped to exact timestamps.
5. **Limits (Constraints & Negatives):** What must remain stable and what must not appear.

---

### Framework 2: The 8-Part Playbook Structure (Cinematic Scripting Mode — Default)
Ideal for high-fidelity, production-grade cinematic scripting:
1. **Reference Job Assignments:** Map out attached assets explicitly (`Image 1 is lead character Mei: maintain facial geometry and attire...`).
2. **Scene / Format / Mood:** Establish environment, genre, time of day, and aesthetic tone.
3. **One Dominant Action:** **CRITICAL TECHNICAL RULE:** Restrict clip to *one* primary physical action/motion to prevent visual warping and physical collapse.
4. **Camera Path & Framing:** Natural cinematographic vocabulary (*slow push in, rack focus, orbit, dolly zoom, Dutch tilt*). **NO bracketed parameter syntax** like `[Push in: 2s]`. Use fluent sentences.
5. **Lighting & Palette:** Direct light sources, color temperatures, reflections, depth of field.
6. **Sound Clause:** Native stereo track detailing dialogue (must be in quotes, e.g. `"spoken"`), environment SFX, and musical cues mapped to timestamps (e.g. `[0s-3s]`, `[4s]`).
7. **Final Beat / Composition:** Camera resting point and final frame layout.
8. **Negative Directions:** Boundaries preventing morphing, extra limbs, garbled text, or unintended animation styling.

---

### Framework 3: Cinematic AI Director Sheet (Reference Asset Generation)
Ideal for helping the user generate a comprehensive visual reference image *before* writing the final H3 prompt. 
When the user needs a robust first-frame reference (for I2VA or FL2VA modes), use this framework to generate a Text-to-Image prompt for an external image generator (e.g., Midjourney, Flux).
- **Core Output:** A text prompt for an image generator that produces a multi-panel "Director Sheet".
- **Instructions:** You MUST consult `resources/cinematic_director_sheet.txt` for the exact prompt structure and required panels (cinematic keyframe, character refs, motion arrows, lighting diagram, etc.).

---

## 2. Key Technical Prompting Rules

1. **For Edits, Pair Changes with Constraints:**
   - *Example:* "Replace the newspaper with a green hardcover book; keep the armchair, wall textures, and subject's outfit exactly the same."
2. **Explicitly Lock Character Identity:**
   - Describe physical traits explicitly in text (hair length/color, clothing fabric, accessories, skin tone) alongside reference images.
3. **Natural Camera Language Only:**
   - **Allowed:** "The camera slowly pushes in towards her eyes while smoothly racking focus from the wet window pane to her face."
   - **Forbidden:** `[Camera: Push in 2s]` or `[Zoom: 50% / 3s]`.
4. **Zero-Indexed Reference Mapping:**
   - Reference attachments MUST be indexed in chronological upload order (`Image 1`, `Image 2`, `Video 1`, `Audio 1`) or tagged as `<Picture 1>`, `<Picture 2>`, `<Video 1>`, `<Audio 1>`.

---

## 3. Validation & Quality Check

Before outputting any MiniMax H3 prompt, you MUST run the Python validator:

```bash
python .agents/skills/minimax-h3-prompter/scripts/validate_h3_prompt.py --input-file <path_to_prompt_md>
```

Fix any warnings (such as bracketed camera syntax, missing sound timestamps, or missing negative directions) before presenting the final brief to the user.

---

## 4. Prompt Formulas (Resources)

When generating prompts, you should utilize the detailed formulas provided in the `resources/` directory to ensure optimal output from the MiniMax H3 model. Specifically:

- For prompts involving reference models, consult: `resources/h3 formula for reference model.txt`
- For text-to-image or image-to-video prompts, consult: `resources/h3 formula for text2image and image2video.txt`

If a task falls into these categories, use `view_file` to read the respective formula document and strictly adhere to its structure and guidelines.
