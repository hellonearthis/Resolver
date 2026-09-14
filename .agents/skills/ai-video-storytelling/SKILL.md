---
name: ai-video-storytelling
description: Directing engine for AI video storytelling. Converts emotional narrative arcs and character continuity bibles into concrete cinematic shots, dream cuts, and MiniMax H3 prompts.
---
# AI Video Storytelling & Acting Engine

A systematic, director-grade framework designed to close the **"Director-to-AI Void"** in generative video. AI video diffusion models cannot interpret abstract dramatic concepts ("sad," "tense," "guarded," "guilty"). This skill translates dramatic and emotional intent into **concrete, generatable, and invariant physical/optical instructions**.

---

## 1. The 6-Pillar Storytelling Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     THE 6-PILLAR STORYTELLING SYSTEM                    │
└─────────────────────────────────────────────────────────────────────────┘
  1. EMOTION-TO-VISUAL       →  Converts emotions into 5 physical/optical channels
  2. TRI-LOCK INVARIANCE     →  Locks [CHAR], [ENV], and [STYLE] blocks to eliminate drift
  3. STATE-TRIGGER MACHINE   →  Models scenes as discrete emotional states & jumps
  4. DREAM & NON-LINEAR CUTS →  Motif loops, match cuts & audio-harmonic pacing
  5. MODEL PROMPT COMPILER   →  Compiles boards directly to MiniMax H3 / ComfyUI
  6. STORYBOARD INSTRUMENT   →  Single source-of-truth production planning sheets
```

> [!TIP]
> **Token Hygiene & Progressive Disclosure:**
> - Consult `resources/dream_cutting_and_nonlinear.md` *only* when generating non-linear motif loops or dream-sequence transitions.
> - Consult `resources/storyboard_instrument_templates.md` *only* when compiling complete multi-shot production workbooks.
> - **Output Persistence:** Write multi-beat video prompts directly to `my_prompts/<project_name>.md`. In chat, provide the shot list summary, technical parameters, and a direct link to prevent conversation bloat.

---

## 2. Pillar 1: Emotion-to-Visual Translation Engine

**Core Law:** *Never prompt an adjective. Prompt only what a camera can photograph or a microphone can record.*

Every internal emotional state must be decomposed into **5 Physical/Optical Channels**:

| Channel | What It Directs | Example ("Guarded / Suppressed Hostility") |
| :--- | :--- | :--- |
| **1. Somatic & Micro-Kinetics** | Gaze angle, blink rate, jaw tension, swallowing reflex, finger pressure, respiration depth. | *Gaze locked 15° off-axis, zero blinking, jaw muscle pulsing rhythmically under skin, shallow collarbone breathing.* |
| **2. Postural Dynamics** | Spine curvature, shoulder elevation, weight distribution, center of gravity. | *Rigid spine held 2 inches off chair backrest, shoulders pinned high, weight planted firmly on heels.* |
| **3. Proxemics & Occlusion** | Interpersonal distance, barrier objects, body angle relative to partner. | *Torso angled 45° away from listener, forearms crossed over chest, coffee mug held as a chest-height shield.* |
| **4. Lighting & Atmosphere** | Key-to-fill ratio, color temperature (Kelvin), specular highlights, shadow wrap. | *Harsh 4:1 key-to-fill ratio, cold 5600K fluorescent overhead, specular sweat sheen on brow, deep socket shadows.* |
| **5. Camera Vector & Optics** | Focal length, camera height, movement speed, trajectory, Dutch angle. | *Tight 85mm prime lens compressing depth, creeping slow push-in at eye-level, zero handheld jitter.* |

> *Full lexicon of 30+ emotions mapped to 5-channel signatures available in:*  
> [`resources/emotion_to_visual_lexicon.md`](file:///c:/Users/Desktop-Dev/Desktop/technical%20vocabulary%20%20nomalizer/.agents/skills/ai-video-storytelling/resources/emotion_to_visual_lexicon.md)

---

## 3. Pillar 2: Tri-Lock Continuity Invariance Engine (CHAR + ENV + STYLE)

**Core Law:** *AI video models have zero persistent memory across shots. Characters, environments, and rendering styles drift unless anchored by immutable, machine-readable lock blocks.*

### A. The 3 Lock Schemas
1. **Character-Lock (`[CHAR]`):**  
   `[CHAR:<ID> | name:<Full> | ref_image:<path_or_tag> | role:<Role> | voice:<3-5 traits> | current_emotion:<State> | arc_stage:<N of Total>]`  
   - Enforces speaker-before-content line grammar: `SPEAKER: [CHAR:<ID>]` $\to$ `ACTION: <somatic direction>` $\to$ `LINE: "<dialogue>"`.  
   - Employs a 2-beat context window (Current Beat $N$ + Previous Beat $N-1$) to prevent future-arc rushing.
2. **Environment-Lock (`[ENV]`):**  
   `[ENV:<ID> | type:interior/exterior | fixed_geometry:<facts> | fixed_palette:<colors> | fixed_props:<objects> | lighting_baseline:<source+quality>]`  
   - Fixed fields (geometry, palette, props) remain invariant.  
   - Variable fields (camera, lighting angle, character positions) shift via `trigger:<event_name>` states with emotional-read notes.
3. **Style-Lock (`[STYLE]`):**  
   `[STYLE:<ID> | render:<technique> | palette:<palette family> | linework:<rules> | lighting_treatment:<description> | grain/finish:<texture>]`  
   - Keeps visual rendering fixed across the entire piece; permits only narrow `<arc_beat_name>` modifiers.

### B. Layered Prompt Construction & 1-to-1 MiniMax H3 5-Block Mapping
Assemble prompts in fixed layer sequence:  
$$\text{Shot Type} \longrightarrow \text{Subject/Action (CHAR)} \longrightarrow \text{Environment (ENV, state)} \longrightarrow \text{Style (STYLE, modifier)} \longrightarrow \text{Mood}$$

Slotting directly into MiniMax H3 5-Block syntax:
- **Block 1 `[Style / Camera / Lighting]`:** `[STYLE:<ID>]` + modifier + Shot Type / Lens / Angle.
- **Block 2 `[Subject / Action]`:** `[CHAR:<ID>]` + `ref_image` + active somatic `ACTION`.
- **Block 3 `[Environment / Atmosphere]`:** `[ENV:<ID>]` fixed geometry + active `trigger:<event>` state.
- **Block 4 `[Audio / Dialogue]`:** Verbatim `LINE` + foley / ambient acoustic tags.

> *Shared universe locks are persisted in `my_prompts/universes/<universe_name>.md`.*

---

## 4. Pillar 3: State-Trigger Emotional Architecture

**Core Law:** *Dramatic scenes are finite state machines, not static continuous moods. Transitions between states create cinematic narrative momentum.*

### The State Machine Model
1. **Defined States ($S_1, S_2, S_3$):** Stable emotional baselines defined by distinct physical signatures.
2. **Defined Triggers ($T_1, T_2, T_3$):** Discrete, photographable catalyst events that force a state change (e.g., third party enters, loud sound, broken eye contact, phone ring).
3. **Transition Speed (Characterization Metric):**
   * **Instant Snap (<0.5s / 1-frame cut):** Practiced concealment, social masking, militaristic discipline, trauma freeze.
   * **Lagged Bleed (1.5s–3.0s gradual decay):** Emotional exhaustion, cognitive dissonance, lingering intimacy, reluctant compliance.

```
┌────────────────────────┐      [T1: Third Party Enters Room]      ┌────────────────────────┐
│ S1: Raw Conflict Mode  │ ───────────────────────────────────────>│ S2: Performed Calm Mask│
│ (0.5m distance, glare) │       Speed: Instant Snap (<0.5s)       │ (Forced smile, 2m gap) │
└────────────────────────┘                                         └────────────────────────┘
            ▲                                                                  │
            │                  [T2: Door Closes / Alone Again]                 │
            └──────────────────────────────────────────────────────────────────┘
                                 Speed: Lagged Bleed (2.5s)
```

> *Detailed guide, transition types, and state maps available in:*  
> [`resources/state_trigger_architecture.md`](file:///c:/Users/Desktop-Dev/Desktop/technical%20vocabulary%20%20nomalizer/.agents/skills/ai-video-storytelling/resources/state_trigger_architecture.md)

---

## 5. Pillar 4: Non-Linear & Dream-Style Cutting Techniques

**Core Law:** *Dream logic and non-linear editing succeed through rigorous visual anchors and audio harmony, preventing surreal scenes from collapsing into visual noise.*

1. **Motif-Driven Anchors:** 1–2 tactile, concrete physical objects (e.g., spinning brass lighter, vibrating water glass, peeling paint) repeated across disparate temporal/spatial environments.
2. **The Loop-and-Variation Engine:** Hold 80% of prompt parameters invariant (environment, lens, lighting, seed, camera path) while isolating a **single delta parameter** (e.g., subject's emotional state, time-of-day, or decay level).
3. **Match-Cut Matrix:**
   * **Kinetic Match Cut:** Match directional velocity across cuts (e.g., rapid whip-pan right into a running figure tracking right).
   * **Graphic Match Cut:** Match framing geometry (e.g., circular spotlight matching a circular vintage wall clock).
   * **Eyeline Match Cut:** Maintain absolute vector coordinates across reverse angles.
4. **Beat-Mapped Audio-Harmonic Pacing:** Sequence cuts to musical structure (Intro $\rightarrow$ Verse $\rightarrow$ Build $\rightarrow$ Drop $\rightarrow$ Decay) rather than literal plot events.

> *Techniques, templates, and dream-cutting playbooks available in:*  
> [`resources/dream_cutting_and_nonlinear.md`](file:///c:/Users/Desktop-Dev/Desktop/technical%20vocabulary%20%20nomalizer/.agents/skills/ai-video-storytelling/resources/dream_cutting_and_nonlinear.md)

---

## 6. Pillar 5 & 6: Storyboard Instrument & Prompt Compiler

This framework uses **Storyboard-as-Instrument** planning sheets that function as the exact source-of-truth for compiling directly into **MiniMax H3** (both 6-Section Reference Model and 8-Part Playbooks).

### Compilation Pipeline:
```
[State/Trigger Map] + [Character Bible] + [Per-Shot Acting Panel]
                         │
                         ▼ (Prompt Compiler Engine)
[MiniMax H3 Production Brief / ComfyUI 6-Section Prompt]
```

### Prompt Compilation Laws:
1. **Event-Driven Chaining (Zero Absolute Timecodes):** Never compile prompts using clock timestamps like `At 00:04.000` or `At 00:10:00`. Diffusion models do not track frame-accurate clock time. Chain shots and state shifts using discrete physical event triggers (`As [Trigger T1: door opens] occurs, the camera cuts to...`, `Upon hearing footsteps fade...`, `Midway through the take...`).
2. **One Dominant Action Per Take:** Restrict each clip to a single primary physical trajectory to prevent diffusion morphing.

> *Production templates, blank workbooks, and compilation workflows available in:*  
> [`resources/storyboard_instrument_templates.md`](file:///c:/Users/Desktop-Dev/Desktop/technical%20vocabulary%20%20nomalizer/.agents/skills/ai-video-storytelling/resources/storyboard_instrument_templates.md)

---

## 7. Narrative Arc & Subtext Foundations (The Shared Bones)

Every AI video sequence directed by this skill enforces core narrative craft rules:
1. **Every Shot Does Two Jobs:** Every visual beat must advance the chronological sequence AND reveal character subtext or atmospheric theme.
2. **Start Late, End Early:** Cut into the scene at the moment of physical/dramatic kinetic onset; cut away before aftermath fully settles so the audience carries the resonance.
3. **Want vs. Wound Dynamic (Adult Scenes):** Direct surface actions colliding with hidden emotional trauma via physical barrier objects, eye-line evasions, and tactile fidgeting.
4. **Child Agency (Kids / Youth Scenes):** Center physical resourcefulness and tangible stakes (a physical object/toy at risk) with rule-of-three escalating attempts.
5. **Hard Sci-Fi Scene Friction:** When directing speculative scenes, treat the scientific/physical constraint as an active antagonist (radiation meters, hull integrity, time lag) rather than an aesthetic backdrop.

---

## 8. Negative Space, Conversational Latency & Metaphorical Displacement

Generative video models naturally suffer from hyperactive pacing—mouths move on frame 1, characters trade dialogue instantaneously, and actions lack human inertia. This module enforces **dramatic negative space**:

```
┌────────────────────────────────────────────────────────────────────────┐
│               THE CONVERSATIONAL LATENCY CASCADE                       │
│  Line Delivered → [1.5s–3.0s Latency Beat] → Mundane Displacement → Response │
│  (Trigger heard)   (Processing silence)    (Object as heat sink) (Held gaze) │
└────────────────────────────────────────────────────────────────────────┘
```

### 1. The Cognitive Latency Beat (Processing Delay)
* **The Rule:** In dramatic sequences, never allow instantaneous dialogue replies. Direct an explicit **1.5s to 3.0s processing window** where the listening character absorbs the line.
* **Physical Mechanics:** Direct the listener's gaze to drop 15° downward, a delayed glottal swallow, or a subtle clench of the masseter (jaw muscle) before returning eye contact to deliver their line.

### 2. Mundane Displacement Activities (The Objective Correlative)
* **Emotional Heat Sink:** When a character experiences overwhelming internal grief, rage, or betrayal, they displace that emotion onto a concrete, mundane physical object rather than screaming or weeping.
* **Directable Prompts:**
  - *"Instead of answering, she slowly folds the paper receipt in half twice, pressing the crease flat with her thumbnail."*
  - *"He stares down at his tea mug, stirring once in silence, listening to the spoon chime against the ceramic."*
  - *"His fingers rhythmically trace the rusted edge of the shed table; five seconds of silence pass before he speaks."*
* **The Metaphoric Anchor:** The physical object absorbs the unsaid subtext, allowing the visual prompt to carry dramatic resonance without on-the-nose expository lines.

### 3. Acoustic Negative Space (Audio Bed Hygiene)
* **Ban Continuous Muzak:** In MiniMax H3 sound design, strictly forbid continuous cinematic strings or trailer swells during intimate dialogue.
* **Enforce Room Tone:** Demand intimate domestic foley to fill the pause:
  - `[02s-05s: Dead air and silence between characters; low hum of an old refrigerator compressor, faint rain tapping single-pane glass, no music].`

### 4. Somatic Restraint & Status Dynamics
* **High-Status Silence:** The dominant psychological figure in the room holds eye contact without speaking, using dead air to exert pressure.
* **Containment vs. Expression:** Direct the **struggle not to break down** (rigid spine, shallow collarbone breathing, unblinking dry eyes) rather than melodramatic emotional outbursts.


