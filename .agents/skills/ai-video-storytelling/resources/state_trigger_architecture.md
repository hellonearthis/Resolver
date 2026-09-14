# State / Trigger Emotional Architecture

## 1. The Finite State Machine Model of Dramatic Narrative

Traditional screenwriting approaches scenes as continuous linear dialogues. When directing AI video models, this produces wandering, muddy generations where actors drift into generic expressions.

In this framework, **a scene is modeled as a Finite State Machine (FSM)**:
* **States ($S_n$):** Discrete, stable emotional modes defined by photographable physical signatures (posture, proxemics, gaze, respiration).
* **Triggers ($T_n$):** Discrete physical, acoustic, or social events that force a transition from one state to another.
* **Transition Velocity ($\Delta t$):** The precise speed of the transition, which serves as a powerful characterization tool.

```
       ┌────────────────────────┐
       │   S1: RAW CONFLICT     │
       │ - 0.4m nose-to-nose    │
       │ - Flared nostrils      │
       │ - Raised voices        │
       └───────────┬────────────┘
                   │
                   │ [T1: Third Party Opens Door (Instant Snap <0.5s)]
                   ▼
       ┌────────────────────────┐
       │  S2: PERFORMED CALM    │
       │ - 2.0m physical split  │
       │ - Forced social smile  │
       │ - Smooth polite voice  │
       └───────────┬────────────┘
                   │
                   │ [T2: Third Party Exits & Latches Door (Lagged Bleed 2.5s)]
                   ▼
       ┌────────────────────────┐
       │  S3: EXHAUSTED POST-MORTEM
       │ - Slumped spine        │
       │ - Downward gaze        │
       │ - Heavy breath release │
       └────────────────────────┘
```

---

## 2. Trigger Taxonomy: Catalysts of State Change

Every trigger must be an explicit, photographable or audible event:

| Trigger Class | Mechanism | Visual & Auditory Signature in Prompt |
| :--- | :--- | :--- |
| **1. Social Intrusion ($T_{\text{social}}$)** | An external witness enters the private space. | Door swings open, footsteps cross threshold, third party calls out a greeting. |
| **2. Physical Threshold ($T_{\text{spatial}}$)** | A character crosses an architectural line or boundary. | Stepping from rain into indoor light; crossing a doorway; slamming down an object. |
| **3. Acoustic Shock ($T_{\text{acoustic}}$)** | Sudden sound event breaking existing focus. | Phone rings sharply; glass shatters; distant thunder; gunshot; sudden silence. |
| **4. Cognitive Shift / Revelation ($T_{\text{intel}}$)** | A secret, document, or prop is seen/unveiled. | Tearing open an envelope; discovering a hidden photo; pulling off a disguise mask. |
| **5. Tactile Contact ($T_{\text{tactile}}$)** | Physical touch breaking psychological barriers. | Hand placed on shoulder; sudden slap; cold rain hitting face; grabbing an arm. |

---

## 3. The Physics of Transition Velocity ($\Delta t$)

The speed at which a character transitions between states defines their psychology and internal control:

### 1. The Instant Snap ($\Delta t < 0.5\text{s}$ / Single Frame Cut)
* **Psychological Meaning:** Practiced deceit, corporate survival instinct, deep training, military discipline, trauma freeze.
* **Directing Execution:** In the very frame the trigger occurs, the character's facial muscles instantly lock into the new mask. Zero intermediate transition frames. Posture straightens instantaneously.

### 2. The Lagged Bleed ($\Delta t = 1.5\text{s} - 3.0\text{s}$ Gradual Decay)
* **Psychological Meaning:** Emotional exhaustion, cognitive overload, lingering intimacy, physical fatigue, loss of self-control.
* **Directing Execution:** The character attempts to adopt the new state, but somatic residuals of the previous state leak through (e.g., trembling fingers, an eyelid twitch, delayed exhale, chest still heaving from previous rage).

### 3. The Oscillating Glitch
* **Psychological Meaning:** Acute psychological breakdown, panic, extreme cognitive dissonance.
* **Directing Execution:** The character rapidly flickers between a forced smile and a panicked grimace, looking between the witness and the opponent.

---

## 4. Master Worked Walkthrough: The "Raw Conflict to Performed Mask" Scene

### Dramatic Premise:
Two high-level executives (Sarah and Marcus) are locked in a venomous, hushed confrontation in a boardroom. Suddenly, the CEO (Arthur) enters the room holding coffee. Sarah and Marcus must instantly mask their conflict into professional collaboration. When Arthur leaves, the mask decays into exhausted defeat.

---

### Step 1: State & Trigger Definitions

```text
[STATE DEFINITIONS]
S1: RAW CONFLICT
- Proxemics: 0.3m distance across corner of mahogany table, leaning forward aggressively.
- Sarah: Jaw clenched, right index finger pressed firmly into documents, eyes blazing at Marcus.
- Marcus: Teeth barred, forearms braced flat on table, veins pulsing in neck.
- Lighting: Hard 4:1 side key casting sharp table reflections.

S2: PERFORMED CALM (THE CORPORATE MASK)
- Proxemics: 1.8m distance, standing erect and relaxed.
- Sarah: Polished social smile, head tilted 5° attentively, hands clasped loosely in front.
- Marcus: Neutral expression, holding a blue pen casually, nodding in fake agreement.
- Lighting: Even high-key fill eliminating sinister shadows.

S3: EXHAUSTED POST-MORTEM (THE DECAY)
- Proxemics: Backs turned to each other, resting against opposite walls.
- Sarah: Spine slumped, head in hands, long slow breath releasing tension.
- Marcus: Eyes fixed on the floor, rubbing temples, shoulders sagging.

[TRIGGERS]
T1: CEO Arthur pushes open the heavy frosted glass door with a brisk click. (Transition: S1 -> S2 | Velocity: Instant Snap <0.5s)
T2: CEO Arthur closes the door and footsteps fade down the hallway. (Transition: S2 -> S3 | Velocity: Lagged Bleed 2.5s)
```

---

### Step 2: Compiled MiniMax H3 3-Shot Sequence

```text
detailed_description:
The sequence uses a high-end cinematic drama aesthetic with 35mm shallow depth of field and anamorphic lens flares in a sleek boardroom.

[Shot 1] A tight medium two-shot frames Sarah and Marcus in [S1: Raw Conflict]. Standing only a foot apart over the boardroom table, Sarah leans in with furious intensity, whispering with venomous cadence, "If this leaks, you are finished." while Marcus's jaw muscles pulse with suppressed rage.

[Shot 2] At 00:04.000, the camera cuts to a medium-wide shot as [T1: Door clicks open]. In an [Instant Snap under 0.5s], Sarah and Marcus step smoothly apart into [S2: Performed Calm]. By the time Arthur enters holding his coffee mug, Sarah is already smiling warmly, gesturing politely at the chart and saying in a cheerful corporate tone, "Good morning, Arthur! We were just finalizing the quarterly projections." while Marcus offers a calm, polished nod.


[Shot 3] At 00:08.500, the shot cuts as [T2: The door clicks shut]. As Arthur's footsteps fade into silence, over a [Lagged Bleed of 2.5 seconds], the fake smiles slowly evaporate from their faces. Sarah's shoulders drop into [S3: Exhausted Post-Mortem] as she collapses her head into her hand with a shuddering exhale, while Marcus stares hollowly at the polished table.
```
