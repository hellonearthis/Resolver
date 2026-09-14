# Storyboard-as-Instrument Planning Templates

A unified production workbook that functions as the **single source of truth** for planning AI video scenes and compiling them directly into MiniMax H3 (ComfyUI / API) prompts.

---

## Part 0: Character Continuity Bible (Fill Once Per Character)

```markdown
### Character Bible: [Character Name]

| Field | Invariant Production Value |
| :--- | :--- |
| **Role & Identifier** | e.g. `<Subject 1>` / Lead Investigator Elena |
| **Anatomical Lock** | Age, heritage, facial structure, eye shape/color, hair length/curl/color, distinctive marks |
| **Wardrobe Lock** | Exact garments, fabric weave/weight (e.g. 14oz raw denim), collar, buttons, distressing |
| **Lighting Signature** | Fixed key/fill ratio and color temperature (e.g. 3200K key from 45° left, 5600K rim) |
| **Proxemic Baseline** | Default posture, walking pace, center of gravity |
| **Reference Assets** | `<Picture 1>` (Identity), `<Picture 2>` (Wardrobe/Turnaround), `<Audio 1>` (Voice Timbre) |
| **Prohibited Morphs** | Hair color changes, jewelry shifts, casual clothing swaps, face smoothing |
```

---

## Part 1: State / Trigger Narrative Map (Fill Once Per Sequence)

```markdown
### Emotional State Machine

#### 1. Defined States
| State ID | State Name | Physical / Somatic Signature (Concrete, No Adjectives) |
| :--- | :--- | :--- |
| **S1** | *[e.g. Raw Conflict]* | *[e.g. 0.4m nose-to-nose, nostrils flared, jaw clenched, high chest breathing]* |
| **S2** | *[e.g. Performed Mask]* | *[e.g. 1.8m distance, forced symmetrical smile, hands clasped, steady eye contact]* |
| **S3** | *[e.g. Post-Mortem]* | *[e.g. Slumped spine, head in hands, downward gaze, shuddering long exhalation]* |

#### 2. Defined Triggers
| Trigger ID | Catalyst Event | State Transition | Transition Velocity ($\Delta t$) |
| :--- | :--- | :--- | :--- |
| **T1** | *[e.g. Third party enters doorway]* | S1 $\rightarrow$ S2 | Instant Snap (<0.5s / 1-frame cut) |
| **T2** | *[e.g. Door clicks shut / alone again]* | S2 $\rightarrow$ S3 | Lagged Bleed (2.5s gradual decay) |

#### 3. Execution Graph
`S1 (Raw Conflict) ──[T1: Third party enters / Instant]──> S2 (Performed Mask) ──[T2: Door shuts / 2.5s Bleed]──> S3 (Post-Mortem)`
```

---

## Part 2: Per-Shot Acting-Note Panel (Copy Per Shot)

```markdown
### Shot [#] — [Shot Working Title]

| Field | Production Specification |
| :--- | :--- |
| **Time Window** | `[00:00.000–00:04.500]` (H3 timestamp format) |
| **State / Trigger ID** | `S1`, `T1`, `S2`, etc. |
| **Reference Asset Roles** | `<Picture 1>` (Identity), `<Picture 2>` (Storyboard Plate), `<Audio 1>` (Voice) |
| **Camera Path & Lens** | e.g. 35mm prime, creeping slow push-in at eye level, zero handheld shake |
| **Dominant Physical Action** | Active verb + direction + speed (e.g. *slams palm down onto desk documents*) |
| **Acting Note (Somatic)** | Exact somatic cue from State Map (gaze angle, blink rate, respiration, jaw) |
| **Dialogue Tag** | `says, "exact line in quotes"` |
| **Sound & Foley** | Diegetic room foley, physical impacts, ambient drone |
| **Style Lock** | Consistent aesthetic string (e.g. *35mm anamorphic film, gritty 1980s noir drama*) |

#### Compiled H3 Shot Block:
```text
[00:00.000–00:04.500] <Camera Path> frames <Subject 1> in <State ID>. <Subject 1> performs <Dominant Action>, <Acting Note Translated into Visible Physics>. <Subject 1> (S1) speaks with <Audio 1> voice timbre and says, "<Dialogue>". <Sound / Foley>.
```
```

---

## Part 3: Sequence Quality & Readiness Checklist

Before sending prompts to generation, verify every checkpoint:

- [ ] **1. Zero Emotional Adjectives:** All emotion words ("sad," "angry," "nervous") are converted into 5-channel physical/somatic signatures.
- [ ] **2. Verbatim Character Bible:** Every character's locked identity block is copied verbatim across shots without paraphrasing.
- [ ] **3. State Transition Clarity:** Every cut corresponds to a defined State hold or an explicit Trigger event.
- [ ] **4. Transition Velocity Enforced:** Prompts explicitly direct whether emotional shifts occur as an **Instant Snap (<0.5s)** or a **Lagged Bleed (1.5–3.0s)**.
- [ ] **5. Natural Camera Language:** Zero bracketed camera parameters (e.g., `[Push in: 2s]`); camera directions use fluent cinematic sentences.
- [ ] **6. Quoted Dialogue:** All dialogue and spoken lyrics use standard double quotes (e.g. `says, "exact text"`) with consistent speaker IDs `(S1)`, `(S2)`.
- [ ] **7. Negative Boundary Guardrails:** Explicitly bans morphing, costume swaps, floating limbs, and comic UI overlays.

