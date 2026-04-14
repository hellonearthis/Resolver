# 🎨 Storyboard Module

The **Storyboard Module** provides a narrative-driven, card-based interface for building visual stories. It unifies narrative metadata (action, dialogue, sound) with AI image generation and rhythmic timing, allowing you to "corkboard" your music video before or alongside final assembly.

---

## Key Concepts

### 🃏 The Card-Based Design
Each card in the storyboard represents a single shot or segment on your project timeline.
- **Visual Evidence**: Shows side-by-side **Start** (head) and **End** (tail) frames of the shot.
    - **Contextual Frame Linking**: Click a frame slot to open a menu. For **Start Images**, you can now "Copy Prev Video End Frame" or "Copy Prev Beat Frame" (exact sync). For **End Images**, you can copy the "Next Clip Start" frame for visual continuity.
- **Motion Preview**: Hover over the card to play a muted preview of the currently selected video version.
- **Duration Shortcuts**: While hovering over a card, use the **Up/Down arrow keys** to instantly adjust the shot's duration in LTX-aligned units (8 frames at a time). The active card will glow indigo to indicate it is ready for keyboard input.
- **Right-Click Edit**: Right-click any card or text field to open the universal **Prompt/Duration Editor** for precise control. A "Right-click to open large editor" tooltip is visible on hover.
- **Empty Slots (Padding)**: Unused timeline space is visually represented by "Empty Slot" placeholder cards. These fill the entire gap between shots or at the end of the project, allowing you to "Fill Gap" with a single click.
- **Clean Layout**: Textareas are now capped at ~10 lines (200px) and hide scrollbars to keep cards uniform. The entire grid uses native browser scrolling for a glitch-free experience with variable-height content.

---

## 🤖 AI Cinematic Expansion (Tri-Tier Workflow)

The Storyboard features a brand-new **Tri-Tier Prompt Engineering** system designed for high-fidelity LTX video generation. This workflow transforms a simple idea into a professional cinematic description.

### 1. The Tri-Tier System
Your video generation prompt is built from three distinct layers:
- **Tier 1: Image Description** (Top Box) — AI-generated description of your **Start Image**. This provides the "visual foundation" (lighting, costumes, location).
- **Tier 2: Clip Action** (Middle Box) — Your manual intent. This is where you describe *what happens* in the shot (e.g., "The figure turns and walks toward the sunset").
- **Tier 3: AI Expanded Prompt** (Bottom Box) — The professional LTX target. Clicking **✨ Reword** combines Tiers 1 & 2 into a single, high-fidelity LTX cinematic prompt.

### 2. Magic Expansion (✨ Reword)
Use the **✨ Reword** button to trigger the expansion. This uses either your **Local NPU (Intel Vino)** or **LM Studio** backend to rewrite your scene into professional cinema-speak.
- **Provider Icons**: Look for the **🍷 (Vino)** or **🏢 (LM Studio)** icons to see which engine is currently active.
- **Tooltips**: Hover over the icons or the Reword button to see exactly which hardware device will be used.

### 3. Locking (🔒/🔓)
High-quality AI results are precious. 
- Click the **🔓 Lock** icon to protect a generated prompt.
- Once locked, the **✨ Reword** button is disabled, preventing accidental overwrites. 
- You can still manually edit a locked prompt (Right-click for the large editor), and common-sense updates still save instantly.

### 4. Generation Logic
When you click **🎬 Generate**, the app prioritizes the **AI Expanded Prompt** if it exists. If it's empty, it falls back to your manual **Clip Action**. This ensure you always have maximum control over the final video result.

---

## 🪄 Instant Generation & Versioning
Each card has a built-in magic wand to trigger AI frame generation directly from your prompt.
- **Video Versioning**: Generate multiple takes for a single shot and use the **Clip Version** dropdown to switch between them. The active version is immediately updated on your project timeline.

---

## ⏱️ Rhythmic & Script Timing

The Storyboard is deeply integrated with the project's rhythmic engine and AI constraints.
- **Start → End Tracking**: Cards explicitly display their project-wide timestamps.
- **LTX-2 Timing Constraints**: All shot durations (manual or auto-calculated) automatically snap to the nearest valid LTX-2 frame boundary `(n * 8 + 1)`. Because duration is calculated as `frames / FPS`, the exact second values will vary depending on your project's frame rate (e.g., 20fps vs 24fps).
- **Sequential "Ripple" Sync**: Any change to a shot's duration automatically shifts all subsequent shots, maintaining a gapless sequence.
- **Live Auto-Save**: All edits (labeling, prompts, timing, image selection) are saved to your project storage **immediately** as they happen.
- **Script Timer**: Automatically calculates shot duration based on the word count of the **Dialogue** field and your playback pace (WPM), perfectly aligned for AI generation.

---

---

The Storyboard is **not** a separate container—it is a different view of the same project data.
- **Persistent Timeline**: A filmstrip-style timeline is persistently visible at the bottom of the storyboard, providing continuous sequential context.
- **Project Sync**: Changes made in the Storyboard (labels, prompts, timings, video versions) are reflected 1:1 in the **Project Timeline** table.
- **Interactive Timeline Editor**: Explicitly adjust Start/End times in the table; editing Start shifts the whole clip, while editing End adjusts duration with LTX-2 snapping.

---

## Developer Architecture

- **`src/modules/StoryboardModule.tsx`** — Core logic for grid mapping and ripple timing sync.
- **`src/components/storyboard/StoryboardCard.tsx`** — The interactive card component with dual-previews and versioning.
- **`src/components/storyboard/AnimaticTimeline.tsx`** — A horizontal filmstrip view for quick sequence review.
- **`src/types/storyboard.ts`** — Narrative and technical metadata types.
- **`src/types/assembler.ts`** — Unified `VideoClip` model shared between Storyboard and Timeline.

---

## Troubleshooting

- **"Local resource not allowed"**: Ensure you are using the `media://` protocol for images and videos. The application provides `pathToMediaUrl` utility for this.
- **Timing Gaps**: If shots aren't gapless, verify that the `handleUpdateCard` ripple logic is correctly calculating `nextStartTime` using `updatedClip.endTime`.
- **Missing AI Prompt**: Ensure legacy data is migrated—the app fallbacks to `promptText` or `actionNotes` if `notes.action` is empty.
