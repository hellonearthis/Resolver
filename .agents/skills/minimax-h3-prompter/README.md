# MiniMax H3 Prompter

## Overview
This skill acts as a Director and Technical Producer for the MiniMax H3 multimodal model. It generates highly detailed, strictly formatted production paperwork and director's briefs for text, image, video, and audio generation tasks.

## Operating Frameworks
1. **5-Block Structure (Creative Brief Mode):** Fast 5-part brief (Roles, Beats, Look, Sound, Limits).
2. **8-Part Playbook Structure (Cinematic Scripting Mode):** Comprehensive production script specifying reference mapping, mood, dominant action, natural camera vectors, lighting, native stereo audio, final frame, and negative directions.
3. **Cinematic AI Director Sheet:** Generates structured multi-panel visual reference prompts for image generators (Midjourney/Flux) prior to video synthesis.
4. **Grounded Micro-Beat Cinematic Directing:** Ultra-realistic single-shot directing featuring event-driven micro-beats with physical cause-and-effect transitions (standard shot range headers allowed; intra-shot 'at'/'from' action timecodes forbidden), in-beat negative guardrails, tactile physics & fluid adherence, somatic performance cues, and restrained foley/score mixing.
5. **Video Inpainting & Object Replacement (Ref2VA / LanPaint):** Specialized dual-input (`ref_video_0` source plate + `ref_image_0` reference) 6-section inpainting workflow for ComfyUI and LanPaint AV node graphs.
6. **Motion Spine & Kinetic Match-Cut Engine (H3 Max Motion Mode):** Seamless multi-scene continuous kinetic flow, motion spine trajectories (smoke lines, brushstrokes, cables), and precomposed typography layer integrity.
7. **80s Broadcast & Somatic Restraint Lens Profile:** Authentic period television drama (BBC prestige, 70s–80s procedurals), stationary pedestal with creeping motorized optical zoom, 3200K tungsten halogen practicals, Plumbicon tube halation, 1-inch tape raster, and unhurried conversational latency beats.
8. **Dialogue & Spoken Lyrics Rule:** Enforces standard double quotes (`says, "dialogue"`) and bans `<d>` tags to ensure reliable acoustic synthesis.
9. **Simulating Physical Lens Filters & Optics:** Simulates physical camera filters (Polarizing CPL, Anamorphic, Neutral Density ND, Vintage / Retro, Macro, 35mm Film Stock) using functional light interaction descriptions and paired camera moves.

## How to Use
Ask the agent to write a MiniMax H3 prompt for your video idea or reference assets:

**Example Prompts:**
- "Generate a MiniMax H3 prompt for a surfer at golden hour using an anamorphic lens and polarizing filter look."
- "Generate a MiniMax H3 prompt for a cinematic shot of a futuristic city using the 8-Part Playbook Structure."
- "Write an ultra-realistic single-shot prompt in Grounded Micro-Beat style for a pilot grieving over a fallen mech."
- "Generate a Cinematic AI Director Sheet prompt for a cyberpunk street chase."
- "Write a MiniMax H3 inpainting prompt to swap the jacket of a character in my source video with a futuristic leather trench coat from my reference image."

## Validation
The skill includes a standalone validator script:
```powershell
python .agents/skills/minimax-h3-prompter/scripts/validate_h3_prompt.py --input-file path/to/prompt.md
```

