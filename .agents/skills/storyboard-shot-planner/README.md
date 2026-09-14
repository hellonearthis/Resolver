# Storyboard Shot Planner

## Overview
This skill converts a single still image, concept frame, keyframe, or storyboard sketch into a director-level shot plan and generates model-tailored, copy-ready prompts for **MiniMax Hailuo H3** and **Gemini Omni 1.1 Flash** (image-to-video).

## Core Architecture
1. **Scene Read:** Detailed director breakdown extracting subject identity, setting, composition, lighting, emotional mood beats, and frozen motion cues.
2. **Camera & Motion Plan:** Proposes camera path, speed, subject micro-actions, secondary environmental kinetics, duration (4–15s), and continuity constraints.
3. **Dual-Model Compilation:**
   * **MiniMax Hailuo H3:** Compact production-brief flowing prose with first-frame anchor lines and soundscape directions.
   * **Gemini Omni 1.1 Flash:** 5-part direct directive (`Goal`, `Input role`, `Scene`, `Motion`, `Constraints`) designed for conversational iteration.

## How to Use
Upload or reference any storyboard frame, concept art, or still image:

**Example Prompts:**
- "Prep this storyboard frame for video generation in Hailuo H3 and Omni 1.1."
- "Outline the camera and motion plan for this keyframe."
- "Turn this concept sketch into a 6-second video prompt."

## What to Expect
You will receive:
1. **Scene Read** (bullet points)
2. **Camera & Motion Plan** (bullet points)
3. **Two copy-ready prompt blocks:** Labeled clearly for Hailuo H3 and Gemini Omni 1.1 Flash.
