# MiniMax H3 / H3 Max: Motion Spine & Kinetic Transition Engineering

Based on extensive benchmarking and production testing across thousands of generations on MiniMax H3 / H3 Max, this guide provides advanced prompt engineering frameworks for **seamless kinetic transitions, typography/motion graphics, and continuous match-cuts**.

---

## 1. The Motion Spine Architecture

When generating complex, continuous multi-scene videos where one object or environment morphs into another, declaring independent scene descriptions causes the model to jump-cut or stutter. 

Instead, define a **Motion Spine**—a single persistent physical element, geometric trajectory, or line of action that connects every beat in the video:

### Examples of Motion Spines:
* **The Continuous Smoke Line (Cowboy Bebop aesthetic):**
  > "The motion spine is one continuous smoke line. The smoke line, record groove, and brass rim must share the same clockwise trajectory."
* **The Shared Cable / Conduit (Evangelion aesthetic):**
  > "The motion spine is one unbroken industrial cable line. Each passage inherits geometry and trajectory from the cable while surrounding environments shift."
* **The Diagonal Brushstroke (Anime / Demon Slayer aesthetic):**
  > "The motion spine is one continuous diagonal brushstroke. The fabric pattern, sword edge, water splash, and flame all follow this identical diagonal path."
* **The Fluid / Vapor State Shift (Spirited Away aesthetic):**
  > "Steam becomes fog, fog becomes water reflection, water becomes ink, and ink folds into living silhouettes."

---

## 2. Passage Grouping & Camera Laws

Organize sequential match-cut prompts into **Passages** governed by explicit inheritance and camera behavior:

* **Formula:** "Use exactly 15 clues, grouped into five passages of three clues. Each passage has one dominant transformation law and one camera behavior."
* **Camera Laws:** Assign one unhurried camera behavior per passage:
  1. *Passage 1:* Quiet slow push-in.
  2. *Passage 2:* Low lateral tracking move.
  3. *Passage 3:* Left-to-right fluid follow.
  4. *Passage 4:* Fast pullback.
  5. *Passage 5:* Locked frontal hold.
* **Inheritance Directive:** *"Every transition inherits line, pattern, material, or trajectory from what is already visible on screen."*

---

## 3. Typography & Motion Graphics Directives

When directing text animations, title sequences, UI graphics, or brand logo transitions, use these strict rules to prevent character scrambling and visual warping:

```text
Every transition comes from an existing text container, crop edge, or baseline.
Render every phrase as one complete professionally typeset precomposed layer.
Never construct, scramble, morph, glitch, regenerate, rotate, bend, or animate individual letters.
Directional blur only on moving slabs and masks. Zero blur while text is readable.
Typography is always the transition source. Camera moves through negative spaces inside letters.
Strokes become dividers. Words become masks.
```

### Exact Sub-Second Range Timestamping:
```text
0.00-3.00 - TITLE TILE: Move the tile and phrase together as one rigid component.
3.00-6.30 - SLAB TO CROP WINDOW: A cobalt vertical crop window opens inside it and reveals the second complete phrase.
6.30-10.20 - BASELINE TO FRAME: The cobalt rail moves downward and becomes the baseline beneath the third phrase. The rail continues across the screen, turns at clean right angles, and draws the perimeter of a centered rectangular frame.
10.20-12.80 - MASK REVEAL: Final headline reveals through the center of the frame.
12.80-15.00 - HOLD: Stop camera and layer movement. Hold perfectly sharp and unchanged through the final frame.
```

---

## 4. Production Engineering & Inference Settings

### 1. Prompt Expansion Settings
* **Disabled:** Select `Prompt Expansion: Disabled` when your prompt is written using MiniMax H3 Playbooks or Grounded Micro-Beats. This prevents the platform LLM from hallucinating conflicting adjectives or morphing directions.
* **Balanced:** Use when you have a general description with loose timecodes.
* **Quality:** Use only for short (1–2 sentence) prompts.

### 2. Splicing & Acceleration Trimming
* Video diffusion models inherently start motion slowly from $t=0.00$ before reaching target velocity.
* **Pro-Tip for Fast Edits:** When generating multi-part chained videos, trim the first **1.0 second** off downstream clips before splicing into an already fast-moving sequence.

### 3. First & Last Frame Anchoring
* For high-density graphic elements (brand logos, dense benchmark charts, intricate faces), generate the exact keyframe in an external high-fidelity image model (e.g. Flux / GPT-Image-2), then use H3 I2V or FL2VA to bridge the motion seamlessly.
