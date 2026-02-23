# 🎬 Video Assembler Module

The **Video Assembler** is a powerful environment for synchronizing video clips to specific rhythmic elements of your music. It brings together stem separation, beat analysis, and specialized playback controls to help you build rhythmically perfect montages.

## Key Features

### 1. Project Integration
Projects flow from the **Stem Separation** module. When you separate stems and analyze beats, your project is saved to local storage and can be loaded into the Video Assembler.

### 2. Multi-Stem Visualization
- **Persistent Stems**: View all separated tracks (Drums, Bass, Vocals, etc.) simultaneously.
- **Stem-Specific Beats**: Each stem displays its own transient markers, allowing you to align visuals to a specific instrument (e.g., cutting on the snare or the bass pluck).
- **Linked Zoom**: Use the zoom slider to expand or contract all waveforms in sync, maintaining perfect horizontal alignment.

### 3. Advanced Playback Controls
- **Main Track Controls**: Dedicated **▶ Play** and **⏸ Pause** for the master audio.
- **Individual Stem Auditing**: Each stem has its own **▶ Play** and **⏸ Pause** buttons.
- **Audit Mode (Play Stems)**:
    - Plays all stems from the beginning (`0s`).
    - Automatically mutes the main track.
    - Dims and grayscales the main waveform to visually highlight that you are in "Stem Audit" mode.

### 4. Rhythmic Interaction
- **Snap to Beat**: When selecting a region to trim a clip, the selection handles automatically snap to the nearest beat marker.
- **Beat Source Selector**: On the main track, you can choose to overlay beats from any specific stem. This allows you to "see" the drums on the main track while you work.
- **Downbeat Highlighting**: Every 4th beat is visually emphasized as a thicker line to help identify measures.

## Workflow: Sequence to Resolve

1.  **Import**: Load a project that has stems and beat analysis.
2.  **Sync**: Identify the specific stem you want to sync to (e.g., Drums).
3.  **Select**: Drag a region on the waveform. It will snap to the beats.
4.  **Generate**: Click **"Generate Clip from Selection"**.
5.  **Assemble**: The app tracks your clips using a **Checkerboard pattern** (alternating tracks) to avoid overlapping transitions.
6.  **Export**: Click **"Export to Resolve"** to generate a `manifest.json`.
7.  **Resolve**: Use the **Script Manager** to run the Python assembly script, which imports your media and builds the timeline in DaVinci Resolve automatically.

## Visual Cues

- **Indigo Markers**: Main track beats.
- **Stem Colors**: Matches the project settings (Drums: Red, Bass: Amber, etc.).
- **Grayscale Waveform**: Indicates the track is currently muted or de-emphasized.

## Developer Architecture
Recent refactoring has significantly cleaned up the internal architecture:
- **`src/types/assembler.ts`**: Centralized location for shared interfaces (`VideoClip`, `TimelineRow`, etc.) to improve type safety.
- **`src/utils/timelineUtils.ts`**: Pure helper functions for timeline manipulation, rendering logic, and time formatting, fully unit tested.
- **`src/components/ProjectTimelineTable.tsx`**: The complex timeline table and its editing state are decoupled from the main module, improving modularity and readability.
