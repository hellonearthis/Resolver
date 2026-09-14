# MiniMax H3 Reference Guide: Optical Lens Filters & Physical Camera Simulation

MiniMax H3 (Hailuo 3.0) is a video diffusion transformer, not a physical camera with mechanical lens mounts or filter threads. However, because H3 was trained on millions of cinematic film sequences, **it responds with high visual accuracy to filmmaking vocabulary that simulates physical optical behaviors**.

Rather than relying on abstract terms, H3 excels when prompts explicitly direct **what the optical glass and filters physically do to incoming light, specular reflections, depth of field, and shutter motion blur**.

---

## 1. Prompt Layer Architecture

To reliably trigger physical optical characteristics without confusing the model's spatial reasoning, embed optical keywords inside the **Visual Style / Cinematography** layer of the standard H3 prompt formula:

$$\text{[MM:SS.mmm–MM:SS.mmm]}\quad \text{Subject} + \text{Action} + \text{Scene} + \textbf{Visual / Lens Style} + \text{Camera Movement} + \text{Audio}$$

### ⏱️ Timing Directive: Standard Shot Headers vs. Intra-Shot Actions
- **Shot Boundary Ranges (`00:00.000–00:06.000`):** Standard, valid, and fully supported. Prefixing shots with duration ranges (or sequencing multi-shot cuts like `00:00.000–00:03.000 ... 00:03.000–00:06.000`) establishes proper shot budgets and timeline boundaries in MiniMax H3.
- **Intra-Shot Action Triggers (Avoid 'At' and 'From'):** Never use internal time markers to trigger mid-shot events (e.g., ❌ *"At 00:03.000, she turns"*, ❌ *"From 00:04.000, camera pans"*). Within an active shot, diffusion transformers cannot lock to specific clock intervals. **Always direct intra-shot physical progression using cause-and-effect transitions** (e.g., *"As the surfer wades through the surf..."*, *"Midway through the camera push..."*, *"Upon stepping out of the water..."*).

---

## 2. The 6 Core Lens Filter & Optical Profiles

### 1. Anamorphic Lens Simulation
- **Optical Mechanics:** Asymmetrical cylindrical elements that squeeze a wide horizontal field of view onto the sensor, resulting in oval out-of-focus highlights, horizontal streak flare artifacts, and cinematic widescreen perspective.
- **Recommended Keywords:**
  `anamorphic lens, horizontal lens flares, oval bokeh, cinematic widescreen look, blue streak highlights across bright practical lights`
- **Best Paired Camera Moves:**
  - *Rack Focus:* Shifts focus across subjects, causing out-of-focus background points to morph into elongated oval disks.
  - *Slow Lateral Dolly Track:* Exaggerates horizontal background compression and flares across light sources.
- **Prompt Snippet:**
  > *"Visual style: Photorealistic 35mm anamorphic lens rendering, horizontal cyan lens flares cutting across the headlights, shallow depth of field with distinct vertical oval bokeh in the neon background. Camera: Slow lateral tracking shot at eye level."*

---

### 2. Polarizing Filter (CPL) Simulation
- **Optical Mechanics:** Cuts polarized specular light reflected off non-metallic surfaces (water, wet asphalt, glass windows), eliminating blinding surface glare while maximizing color saturation in skies, foliage, and bodies of water.
- **Recommended Keywords:**
  `polarizing filter effect, reduced surface reflections, cut water glare, see-through glass transparency, deeply saturated blue sky and ocean, high contrast punch`
- **Best Paired Camera Moves:**
  - *Low Tracking over Water / Glass:* Smooth movement skimming over water surfaces or glass facades without blinding specular blowouts.
  - *Slow Orbit around Outdoor Subject:* Emphasizes the rich color saturation of deep blue skies and landscape without washed-out highlights.
- **Prompt Snippet:**
  > *"Visual style: Crisp natural lighting with a polarizing filter effect, eliminating specular water glare to reveal underwater sand patterns, with deeply saturated azure ocean and warm amber horizon. Camera: Smooth tracking shot following alongside the subject at waist height."*

---

### 3. Neutral Density (ND) Filter Simulation
- **Optical Mechanics:** Mechanically attenuates overall exposure across all wavelengths, enabling slower shutter angles (e.g. 180° shutter at slow exposure) in bright daylight. In video, this generates silky, fluid motion blur on fast-moving fluid or clouds rather than staccato, jittery high-shutter frames.
- **Recommended Keywords:**
  `ND filter look, natural shutter motion blur on flowing water, silky smooth waterfall cascade, silky daylight cloud drift, long-exposure shutter fluidity`
- **Best Paired Camera Moves:**
  - *Locked-Off Static Shot:* Isolates moving fluids (waterfalls, rushing tide, highway traffic) so only the dynamic elements exhibit velvety motion blur while surroundings stay sharp.
  - *Unhurried Push-In:* Gentle camera advance that preserves natural kinetic motion blur on cascading rapids.
- **Prompt Snippet:**
  > *"Visual style: Daylight exposure with an ND filter look, producing natural shutter motion blur on the rushing river rapids and silky smooth foam cascades while rocky banks remain sharp and tactile. Camera: Locked-off tripod composition."*

---

### 4. Vintage / Retro Lens Simulation
- **Optical Mechanics:** Simulates uncorrected vintage glass coatings and spherical aberration: soft edge rolloff, slight barrel distortion, warm color cast, gentle fringing/chromatic aberration, and halation around bright practical lights.
- **Recommended Keywords:**
  `vintage lens distortion, slight chromatic aberration, soft edge rolloff, warm film grain, 1970s photography tone, gentle amber halation`
- **Best Paired Camera Moves:**
  - *Slow Motorized Parfocal Zoom:* Creeping in without camera translation, compressing background with subtle optical breathing.
  - *Handheld Shoulder Rig:* Organic human sway harmonizing with vintage optical imperfections.
- **Prompt Snippet:**
  > *"Visual style: 1970s vintage prime lens aesthetic, slight peripheral barrel distortion, gentle chromatic aberration along contrast edges, soft focus rolloff, and organic warm film grain. Camera: Stationary broadcast pedestal with a slow motorized zoom creeping inward."*

---

### 5. Macro Lens Simulation
- **Optical Mechanics:** Extreme reproduction ratio (1:1 or greater) with an exceptionally thin depth of field (fractions of a millimeter), exposing hyper-tactile surface textures (pores, water droplets, fabric weave) against a creamy, melted background.
- **Recommended Keywords:**
  `macro photography, extreme close-up, razor-thin shallow depth of field, microscopic tactile texture, creamy blurred background, sharp focal plane`
- **Best Paired Camera Moves:**
  - *Micro-Creep / Linear Slide:* Extremely slow, minute linear camera push perpendicular to the focal plane.
  - *Focal Plane Rack:* Smooth micro rack focus across surface textures.
- **Prompt Snippet:**
  > *"Visual style: Macro photography with razor-thin depth of field, sharp crisp focus on individual glistening water droplets resting on a beetle's carapace, dissolving into a creamy out-of-focus background. Camera: Slow micro-push maintaining critical focus on the droplet."*

---

### 6. Classic Photochemical Film Stock Simulation
- **Optical Mechanics:** Simulates celluloid grain emulsion, organic photochemical color response curves, highlight halation (orange/red glow around intense light points due to the antihalation backing), and non-linear shadow rolloff.
- **Recommended Keywords:**
  `shot on 35mm film, Kodak Vision3 color grading, organic photochemical film grain, subtle red highlight halation, velvety uncrushed shadows`
- **Best Paired Camera Moves:**
  - *Classic Mitchell Tripod Pan / Tilt:* Smooth mechanical friction head movements.
  - *Steadicam Corridor Track:* Unbroken fluid motion characteristic of late 70s / 80s cinema.
- **Prompt Snippet:**
  > *"Visual style: Shot on 35mm motion picture film with organic photochemical grain, subtle orange halation around bare practical bulbs, rich color reproduction, and natural dynamic range. Camera: Steadicam glide advancing through the narrow hallway."*

---

## 3. Optical Pairing & Synergy Matrix

| Lens / Filter Profile | Primary Visual Effect | Ideal Camera Movement | Optical Benefit |
| :--- | :--- | :--- | :--- |
| **Anamorphic** | Horizontal flare + oval bokeh | Rack focus, lateral tracking | Highlights light sources & cinematic depth |
| **Polarizing (CPL)** | Cuts water/glass reflections, boosts sky | Low tracking, orbital push | Clears glare, produces rich deep colors |
| **Neutral Density (ND)** | Smooth fluid motion blur in bright light | Locked static hold, slow push | Prevents staccato shutter jitter on water |
| **Vintage / Retro** | Chromatic aberration, soft edge rolloff | Parfocal slow zoom, handheld | Adds nostalgic patina & period authenticity |
| **Macro** | Razor-thin focus plane, tactile micro-detail | Micro-slide, focal rack | Isolates minute textures with creamy blur |
| **35mm Film Stock** | Photochemical grain, bulb halation | Steadicam glide, tripod pan | Eliminates synthetic digital 4K sharpness |

---

## 4. Operational Best Practices

1. **Describe Functional Cause and Effect:**
   - ❌ *Weak:* `"Add a polarizing filter."`
   - ✅ *Strong:* `"Visual style: Shot with a polarizing filter effect to eliminate water surface glare and deeply saturate the blue ocean and orange sky."`
2. **Harmonize Lens Physics with Camera Motion:**
   - Pair an anamorphic lens with a rack focus or lateral track so the oval bokeh and horizontal streaks actually interact with moving lighting sources.
3. **Avoid Conflicting Optical Aesthetics:**
   - ❌ Do not prompt: *"hyper-sharp digital 8k clean anime with vintage 1970s chromatic aberration and heavy film grain"*. H3 will produce mushy artifacts or ignore the optical directives entirely.
   - ✅ Keep aesthetics logically cohesive: vintage lenses with film grain and tungsten practicals; anamorphic lenses with widescreen cinema and motivated flares.
4. **Standard Shot Headers vs. Intra-Shot Event Timing:**
   - ✅ Keep standard shot boundary ranges: `00:00.000–00:06.000 [Shot description]`.
   - ❌ Eliminate mid-shot action markers with 'at' and 'from' (e.g. *"At 00:03.000, she looks at the camera"*).
   - ✅ Sequence intra-shot micro-actions with cause-and-effect transitions: *"In the opening beat, as the subject steps out of the surf..."*, *"Midway through the take..."*, *"As the camera completes its lateral track..."*.

---

## 5. Complete Production Examples

### Example 1: Surfer at Golden Hour (Polarizing + Anamorphic Look — 8-Part Playbook)
```text
[Reference Job Assignments]
Pure Text-to-Video. No attached reference assets.

[Scene / Format / Mood]
A windswept coastal beach at golden hour. Warm amber sunlight strikes the rolling ocean swell. Atmospheric sea spray in the air. High-end surf documentary aesthetic.

[One Dominant Action]
A solitary surfer in a black wetsuit wades forward through the shallow break toward the shore, holding a surfboard under one arm as water beads roll off the neoprene.

[Camera Path & Framing]
Slow lateral tracking shot from the side at eye level, moving steadily alongside the surfer's stride. Rack focus gently from the glistening water surface to the surfer's profile.

[Lighting & Palette]
Direct golden hour backlight and warm side bounce. Visual style: Shot with an anamorphic lens and a polarizing filter effect to eliminate water surface glare, deeply saturate the azure ocean and fiery orange sky, and render distant breaking waves with vertical oval bokeh and subtle horizontal flare streaks.

[Sound Clause]
[Continuous] Rhythmic ocean surf breaking and gentle foam hissing against wet sand. Distant gull calls. [On stride] Wet footsteps splashing in shallow water. Ambient warm acoustic guitar swells softly in the background.

[Final Beat / Composition]
The surfer clears the foam line, pausing briefly on the wet sand as the camera glides to a rest in a medium profile silhouette against the sunset.

[Negative Directions]
No blinding water glare blowout, no digital over-sharpening, no circular bokeh, no unnatural jerky motion, no multiple limbs, no garbled background surfers.
```

### Example 2: Alpine Waterfall (ND Filter Long-Exposure Look — 5-Block Structure)
```text
[Roles]
Pure Text-to-Video. No attached assets.

[Beats]
[Beat 1: The Mountain Torrent] Opening on the cascading mountain river framed by moss-covered granite boulders in bright alpine noon daylight.
[Beat 2: The Fluid Cascade] As mist billows gently outward, the rushing white water cascades continuously across tiered rock shelves with velvety motion blur while the surrounding rock face remains razor-sharp and wet.
[Beat 3: The Resting Pool] Toward the conclusion, the foam swirls lazily into an emerald mountain pool in foreground.

[Look]
Visual style: Photorealistic daylight landscape with an ND filter look, producing silky smooth motion blur on flowing water rapids and fine mist drift while preserving deep shadow detail in wet rock textures. Camera: Locked-off wide tripod composition with natural depth of field.

[Sound]
[0s-6s] Deep resonant roar of cascading mountain water, high-frequency rushing foam hiss, subtle mountain breeze through pine needles. Zero artificial music score.

[Limits]
No staccato shutter jitter, no blown-out white water clipping, no digital sharpening halos, no artificial camera shake.
```
