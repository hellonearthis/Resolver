# MiniMax H3 Reference-to-Video (ref2va) Inpainting & Video Editing Guide

This guide establishes the production workflow, node graph routing, and prompt structures for **Inpainting, Object Replacement, Face Swapping, and Costume Swapping** in MiniMax H3 using ComfyUI and the LanPaint AV workflow.

---

## 1. Core Operating Principle: Dual-Input Architecture

To edit existing video footage (rather than generating a new video from scratch), MiniMax H3's Reference-to-Video (`ref2va`) engine requires **both** inputs connected simultaneously:

1. **The Original Video (`ref_video_0` / `<Video 1>`):**
   - Acts as the **Source Plate**.
   - Dictates base motion, character kinematics/physics, unmasked background, lighting, and camera movement.
2. **The Reference Image (`ref_images.ref_image_0` / `<Picture 1>`):**
   - Acts as the **Style / Asset Reference**.
   - Dictates the identity, wardrobe, texture, or object features rendered inside the masked area.

> [!WARNING]
> **Common Failure Mode:** If you provide only a reference image with a mask, H3 has no temporal motion guidance. It will generate a completely new video from the reference image, discarding original motion and camera tracking.

---

## 2. ComfyUI Node Graph Wiring

### Standard Reference-to-Video Routing
- Connect your **Reference Image** to `ref_image_0` (or `ref_images.ref_image_0`).
- Connect your **Original Source Video** to `ref_video_0`.

### LanPaint AV Workflow Routing
When using the LanPaint AV inpainting pipeline:
1. Load original video into `LoadVideo` / `VHS_LoadVideo`.
2. Generate or load the mask on the target region (character, clothing, prop, face).
3. Pipe the source video and mask into the `LanPaint_AVEncode` node to prepare the latent space.
4. Route the encoded latents and reference assets into the MiniMax H3 / ref2va sampler.

---

## 3. The 6-Section Prompt Structure for Inpainting / Ref2VA

Because MiniMax H3 is an omni-modal model, node connections must be explicitly mirrored in the prompt with clear "job assignments" for each reference asset.

### Section Breakdown

```markdown
subject_definitions:
<Subject 1> is the new character style, features, and wardrobe defined by <Picture 1> (Image 1).
<Video 1> is the original source video containing the action and camera motion we are editing.

summary:
[video editing + reference generation] The target video is an edited version of <Video 1>, where the masked area of the character is updated to match the identity and style of <Subject 1> from <Picture 1>.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - the new style and features from Picture 1 are painted onto the masked area.
<Video 1> (source video): partially_preserved - the original camera motion, background, and character physics are perfectly maintained from the unmasked parts.

detailed_description:
Cinematic live-action [genre/style] video.
[Shot 1] The camera maintains the exact framing, environment, and physical camera movement from the source <Video 1>. In the masked region of the clip, the original character is modified to perfectly assume the appearance, clothing, and features of <Subject 1> as defined in <Picture 1>. The new clothing and facial features conform flawlessly to the original character's body pose and muscle movement from <Video 1> as they move. The background remains entirely unchanged throughout the shot.

overall_soundscape:
Original environmental room tone and footsteps from <Video 1> are preserved, with matching acoustic reflections.

non_diegetic_music:
N/A
```

---

## 4. Why This Works: Core Prompt Engineering Mechanics

### 1. The Text-to-Asset Bond
Declared under `subject_definitions:`. It binds `<Picture 1>` strictly to the target visual appearance/wardrobe and `<Video 1>` to the motion/camera plate. This ensures the text encoder does not confuse reference roles.

### 2. Substitution-Constraint Pairs
Declared in `detailed_description:`. Every modification inside the mask is explicitly paired with an invariance constraint outside the mask (e.g., "The new jacket replaces the hoodie in the masked region; the background wall, lighting direction, and hand movements from <Video 1> remain entirely unchanged").

---

## 5. Templates for Common Inpainting Use Cases

### Template A: Costume / Wardrobe Swap
```markdown
subject_definitions:
<Subject 1> is the wardrobe and outfit defined in <Picture 1>, consisting of a [detailed clothing description, fabrics, colors, textures].
<Video 1> is the source video containing the original person walking/moving.

summary:
[video editing + costume replacement] The target video is an edited version of <Video 1>, replacing the original outfit in the masked area with the outfit from <Subject 1> (<Picture 1>).

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - the new outfit from Picture 1 replaces the masked garment.
<Video 1> (source video): partially_preserved - the character's facial identity, hair, hands, physical motion, camera trajectory, and background environment are strictly preserved from <Video 1>.

detailed_description:
Cinematic live-action shot.
[Shot 1] The camera movement, frame rate, and environment are locked to source <Video 1>. In the masked torso/legs region, the character's garment is replaced with <Subject 1> as defined in <Picture 1>. The fabric of <Subject 1> dynamically folds, stretches, and reacts naturally to the subject's gait and physical movement in <Video 1>. Lighting highlights and shadows on the new clothing match the scene lighting of <Video 1>. All unmasked areas (face, hands, background) remain identical to <Video 1>.

overall_soundscape:
Preserve ambient audio and footsteps from <Video 1>.

non_diegetic_music:
N/A
```

### Template B: Character / Face Inpainting
```markdown
subject_definitions:
<Subject 1> is the character face and hair defined in <Picture 1>, featuring [specific facial geometry, hair style/color, skin tone, eye color].
<Video 1> is the source video containing the actor performing [action].

summary:
[video editing + character inpainting] The target video modifies <Video 1> by replacing the actor's face in the masked region with <Subject 1> (<Picture 1>).

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - facial features and head styling from Picture 1 are synthesized onto the head area.
<Video 1> (source video): partially_preserved - the actor's body posture, clothing, head orientation, timing, gestures, background, and lighting are preserved from <Video 1>.

detailed_description:
Cinematic high-fidelity scene.
[Shot 1] The camera angle, movement, and timing match <Video 1> exactly. Inside the masked head area, the character's face is seamlessly replaced with <Subject 1> from <Picture 1>. Facial expressions, eye direction, and mouth movements synchronize with the performance in <Video 1>. The edge of the face blend seamlessly with the neck, hair, and ambient lighting of <Video 1>.

overall_soundscape:
Preserve dialogue and ambient sound from <Video 1>.

non_diegetic_music:
N/A
```

### Template C: Prop / Object Replacement
```markdown
subject_definitions:
<Subject 1> is the prop object defined in <Picture 1>, [e.g., an ornate vintage brass compass with glass lens].
<Video 1> is the source video of an actor holding and manipulating an object.

summary:
[video editing + object replacement] The target video modifies <Video 1> by replacing the held object in the masked area with <Subject 1> (<Picture 1>).

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - the object from Picture 1 is rendered inside the masked area.
<Video 1> (source video): partially_preserved - the actor's hands, finger positions, grip kinetics, camera motion, and background are preserved from <Video 1>.

detailed_description:
Cinematic detailed close-up.
[Shot 1] The camera motion and unmasked hand gestures are strictly preserved from <Video 1>. The object held in the hands within the masked region is replaced with <Subject 1> from <Picture 1>. The object maintains accurate 3D rotation, occlusion with fingers, and surface reflections matching the ambient light in <Video 1>.

overall_soundscape:
Synchronized tactile handling sounds and room tone from <Video 1>.

non_diegetic_music:
N/A
```
