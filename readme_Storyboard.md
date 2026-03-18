# 🎨 Storyboard Module

The **Storyboard Module** provides a narrative-driven, card-based interface for building visual stories. It unifies narrative metadata (action, dialogue, sound) with AI image generation and rhythmic timing, allowing you to "corkboard" your music video before or alongside final assembly.

---

## Key Concepts

### 🃏 The Card-Based Design
Each card in the storyboard represents a single shot or segment on your project timeline.
- **Visual Evidence**: Shows side-by-side **Start** (head) and **End** (tail) frames of the shot.
- **Motion Preview**: Hover over the card to play a muted preview of the currently selected video version.
- **Duration Shortcuts**: While hovering over a card, use the **Up/Down arrow keys** to instantly adjust the shot's duration in LTX-aligned units (8 frames at a time). The active card will glow indigo to indicate it is ready for keyboard input.
- **Right-Click Edit**: Right-click any card to open the universal **Duration Edit Popup** for precise, frame-perfect timing adjustments.
- **Empty Slots (Padding)**: Unused timeline space is visually represented by "Empty Slot" placeholder cards. These fill the entire gap between shots or at the end of the project, allowing you to "Fill Gap" with a single click.

---

## 📝 Action Prompt & AI Integration

The **Action Prompt** field is the "brain" of each card.
- **Unified Logic**: The description you type here is the exact prompt sent to ComfyUI for image and video generation.
- **🪄 Instant Generation**: Each card has a built-in magic wand to trigger AI frame generation directly from your prompt.
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
