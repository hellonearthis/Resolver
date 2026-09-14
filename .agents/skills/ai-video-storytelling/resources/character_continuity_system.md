# Character Continuity & Identity Lock System

## 1. The Continuity Dilemma in Generative AI Video

AI video diffusion models generate each clip independently. Because they possess no internal session memory or persistent 3D world state, characters routinely suffer from:
* **Facial Geometry Drift:** Jawlines, eye shapes, and age shifting across shots.
* **Wardrobe Morphing:** Buttons turning into zippers, jacket colors altering, collar shapes fluctuating.
* **Lighting Contamination:** A character adopting the environmental lighting of whatever background they stand in, losing their cinematic visual signature.

The **Character Continuity System** eliminates drift by creating **Verbatim Invariant Bible Blocks** that are locked into every prompt across a multi-shot sequence.

---

## 2. The 6-Field Character Bible Schema

Every recurring character must be defined using this exact 6-field structure:

```text
======================================================================
CHARACTER BIBLE BLOCK: [CHARACTER_NAME] (Role: [PROTAGONIST / ANTAGONIST / WITNESS])
======================================================================
1. ANATOMICAL SIGNATURE:
   - Apparent age, ethnic heritage, facial structure (e.g. sharp angular jawline, prominent cheekbones, slight Roman nose ridge).
   - Ocular specifics: Eye shape (almond, hooded, deep-set), iris color, brow shape, lash density.
   - Distinctive facial markers: Specific scars, beauty marks, skin undertone, wrinkles/crows-feet.
   - Hair geometry: Exact length, parting, texture (tight curls, straight, shaggy waves), color, styling.

2. WARDROBE & TEXTURE LOCK:
   - Primary garments: Exact clothing item, cut (slim-fit, oversized, tailored), neckline/collar structure.
   - Material specification: Specific weave and weight (e.g. "14oz heavy raw indigo denim", "charcoal worsted wool", "weathered distressed cowhide").
   - Fasteners & Hardware: Metallic buttons, silver zippers, leather belts with brass buckle, watches, rings, necklaces.
   - Wear & State: Clean pressed vs. grease-stained, rain-soaked, rumpled collar.

3. DEFAULT LIGHTING SIGNATURE:
   - Dedicated key/fill lighting setup tailored to this character (e.g., "Warm 3200K key light from 45° camera-left with subtle cool 5600K cyan rim on shoulders").

4. PROXEMIC & MOVEMENT BASELINE:
   - Default posture, walking speed, arm swing amplitude, baseline head posture.

5. REFERENCE ASSET MAPPING:
   - <Picture N>: Role = Identity Anchor (defines face structure and facial proportions).
   - <Picture M>: Role = Wardrobe & Turnaround Anchor (defines 360° clothing seams and materials).
   - <Audio K>: Role = Voice Timbre & Accent Reference.

6. PROHIBITED MORPHS (NEGATIVE GUARDRAILS):
   - Negative boundaries banning hairstyle changes, jewelry morphing, or wardrobe swaps.
======================================================================
```

---

## 3. Worked Production Examples

### Example 1: Lead Investigator "M. Devlin"

```text
CHARACTER BIBLE BLOCK: M. DEVLIN (Lead Investigator)
1. ANATOMICAL SIGNATURE:
   Woman in her mid-30s of Irish/Celtic heritage. High cheekbones, sharp angular jawline, pale skin with light freckles across the bridge of her straight nose. Intense, hooded green-amber eyes with dark natural brows. Voluminous, messy, shoulder-length fiery ginger-red hair with natural wild waves and tendrils falling loosely around her face.
2. WARDROBE & TEXTURE LOCK:
   Loose-fitting, charcoal-grey cotton utility shirt with sleeves rolled up to the mid-forearm, worn open at the collar over a form-fitting black ribbed cotton tank top. Worn silver Latin cross necklace resting on upper chest. Matte black leather strap wristwatch with white dial on left wrist. Laminated clip-on government investigator ID badge ("M. DEVLIN") pinned to left shirt pocket. Heavy dark indigo denim trousers. A burning, filtered paper cigarette held between fingers or lips with rising blue smoke trail.
3. DEFAULT LIGHTING SIGNATURE:
   Directional 3000K warm tungsten key light from camera-left creating sharp chiaroscuro modeling across her cheekbones, backed by a cool 5600K ambient fill.
4. PROXEMIC & MOVEMENT BASELINE:
   Grounded, resolute low center of gravity; deliberate, unhurried strides; steady, unblinking direct eye contact; economical physical gestures.
5. REFERENCE ASSET MAPPING:
   <Picture 1> defines M. Devlin's facial geometry, hair volume, and utility wardrobe.
6. PROHIBITED MORPHS (NEGATIVE GUARDRAILS):
   No smooth straight hair, no blonde or brown hair, no makeup shifts, no clean corporate business suit, no missing cross necklace or wristwatch, no missing cigarette smoke.
```

---

### Example 2: Corporate Antagonist "Auntie Argnaud"

```text
CHARACTER BIBLE BLOCK: AUNTIE ARGNAUD (Corporate Alien Warlord)
1. ANATOMICAL SIGNATURE:
   Slender, elegant reptilian humanoid alien. Sleek, matte olive-green skin with subtle micro-scale texture over high, sculpted zygomatic arches. Large, hypnotic cat-like amber irises with vertical black slit pupils. Elongated, pointed ears extending 3 inches horizontally. No human hair; smooth cranial dome. Thin, serpentine lips naturally curled into an asymmetrical smug smirk.
2. WARDROBE & TEXTURE LOCK:
   Bespoke, sharp-shouldered royal violet wool-blend two-piece business suit. Peak lapels with satin trim, single gold-button closure at the waist. Heavy, polished 18k solid gold Cuban-link chain necklace resting over an open black silk collared undershirt. Matching tailored violet trousers with knife-edge creases.
3. DEFAULT LIGHTING SIGNATURE:
   Cold 4500K metallic blue fill light with an intense 1800K warm gold rim light accentuating the contours of her pointed ears and green cheekbones.
4. PROXEMIC & MOVEMENT BASELINE:
   Slow, serpentine movements; reclining comfortably with legs crossed at the knee; fingertips steepled together; minimal head movement while eyes track target.
5. REFERENCE ASSET MAPPING:
   <Picture 1> defines Auntie Argnaud's green alien anatomy, pointed ears, and purple business suit.
6. PROHIBITED MORPHS (NEGATIVE GUARDRAILS):
   No human skin tones, no human ears, no round pupils, no loose casual clothing, no frantic or hurried movements.
```

---

## 4. Continuity Insertion Rules in Prompts

When generating multi-shot prompts (such as MiniMax H3 or ComfyUI workflows):
1. **Verbatim Re-injection:** Never paraphrase the character bible block between shots. Copy and paste the locked description into every shot's definition.
2. **State Modulation over Identity Modification:** Modify *only* the character's acting parameters (somatic cues, posture, gaze) inside the specific shot description—never their baseline wardrobe or anatomy.
3. **Reference Tag Consistency:** Ensure `<Subject 1>` consistently refers to the exact same Character Bible Block across all shot panels.
