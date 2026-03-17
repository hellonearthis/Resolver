# Project Structure and JSON Format

This document explains the organization of project folders and the structure of the *project data* JSON file (`_data.json`) used by the application.

## 📂 Project Organization

Projects are saved within your configured **Default Project Output Folder** (set in `Settings -> Defaults`).

Each project is stored in its own unique subfolder, prefixed with `PRJ_` to easily identify it as a project directory.

**Directory Structure:**

```
{Default Project Output Folder}/
  ├── PRJ_My_Project/            <-- Project Folder (PRJ_ + Project Name)
  │   └── My_Project_data.json   <-- The main Project Data File
  ├── PRJ_Another_Track/
  │   └── Another_Track_data.json
  └── ...
```

-   **Folder Name**: derived from the project name, sanitized (spaces to underscores, special chars removed), and prefixed with `PRJ_`.
-   **Data File Name**: derived from the project name + `_data.json`.

---

## 📄 JSON File Format (`*_data.json`)

The project data file contains all metadata, analysis results, and timeline information for your project.

### Root Object (`BeatProject`)

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier for the project (e.g., `project-1708329...`). |
| `name` | `string` | The user-defined name of the project. |
| `audioPath` | `string` | Absolute path to the source audio file. |
| `audioFileName` | `string` | Filename of the source audio. |
| `outputDir` | `string` | Absolute path to this project's folder. |
| `frameRate` | `number` | Frame rate used for timeline calculations (e.g., `24`, `30`, `60`). |
| `bpm` | `number` | Detected Beats Per Minute (BPM) of the track. |
| `beatCount` | `number` | Total number of beats detected. |
| `stemType` | `string` | The type of source audio (e.g., `master`, `vocals`, `drums`). |
| `stems` | `Array` | List of separated stem tracks (see *Stems Object*). |
| `markers` | `Array<ProjectMarker>` | **Main track** analysis results in the modern format (see *Data Format Relationship*). |
| `clips` | `Array` | List of video segments created in the timeline (see *Clips Object*). |
| `duration` | `number` | (Optional) Total project duration in seconds (persistent). |
| `elementTray` | `Array` | List of defined characters or locations (see *Element Tray Object*). |
| `createdAt` | `string` | ISO timestamp of creation. |
| `updatedAt` | `string` | ISO timestamp of last update. |

---

### Stems Object (`stems[]`)

Contains information about separated audio tracks (e.g., from Demucs separation via ComfyUI).

| Field | Type | Description |
| :--- | :--- | :--- |
| `type` | `string` | Stem type (e.g., `Vocals`, `Drums`, `Bass`, `Other`). |
| `path` | `string` | Absolute path to the stem audio file. |
| `color` | `string` | Hex color code assigned to this stem for UI visualization. |
| `beats` | `Array<number>` | **Legacy format.** Flat array of beat timestamps in seconds. |
| `markers` | `Array<ProjectMarker>` | **Modern format.** Rich marker objects with type, color, frame info. |

---

### 🔀 Data Format Relationship: `beats` vs `markers`

There are **two generations** of analysis data in the project JSON. Both can exist simultaneously on stems:

#### Legacy: `beats` (flat number array)
```json
"beats": [ 0.4063, 0.8243, 1.2307, 1.6138, 2.0085, ... ]
```
-   **What it is:** A simple array of timestamps (seconds) where beats were detected.
-   **Origin:** Produced by the original Essentia.js `RhythmExtractor2013` analysis.
-   **Contains:** Only beat positions — no type classification, no frame numbers, no colors.
-   **Where it appears:** Inside `stems[]` only (per-stem analysis).

#### Modern: `markers` (ProjectMarker array)
```json
"markers": [
  {
    "timestamp": 0.418,
    "frame": 10,
    "color": "Yellow",
    "note": "Main",
    "type": "beat",
    "duration_sec": 0.041666666666666664
  },
  ...
]
```
-   **What it is:** Rich marker objects with full metadata for DaVinci Resolve export.
-   **Origin:** Produced by the enhanced analysis pipeline (beats + onsets + loudness).
-   **Contains:** Timestamp, frame number (calculated from `frameRate`), marker color, type (`beat`, `onset`, or `loudness`), note/label, and duration.
-   **Where it appears:** At the **project root** (main track analysis) and optionally inside `stems[]` (per-stem analysis).

#### Load Priority

When loading a project, the app checks each stem's data in this order:

1. **`stem.markers`** (modern) — Used if present and non-empty.
2. **`stem.beats`** (legacy) — Fallback if no modern markers exist. Automatically converted to `AudioMarker` objects with inferred downbeat pattern (every 4th beat).

The top-level `project.markers` always uses the modern format and represents the **main track** analysis.

> **Note:** Re-analyzing a stem will produce new data in the modern `markers` format. The legacy `beats` array is kept for backwards compatibility with older projects.

---

### ProjectMarker Object

| Field | Type | Description |
| :--- | :--- | :--- |
| `timestamp` | `number` | Time in seconds where the marker occurs. |
| `frame` | `number` | Frame number (calculated as `timestamp × frameRate`). |
| `type` | `string` | Type of marker: `beat`, `onset`, or `loudness`. |
| `color` | `string` | Color string for Resolve marker visualization (e.g., `"Yellow"`, `"Blue"`). |
| `note` | `string` | Label for the marker (e.g., `"Main"`, stem name). |
| `duration_sec` | `number` | Duration in seconds (1 frame for beats/onsets, span for loudness regions). |

---

### Clips Object (`clips[]`)

Represents the video segments arranged in the **Video Assembler** timeline.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique ID for the clip. |
| `label` | `string` | Display name of the clip in the timeline. |
| `startTime` | `number` | Start time in seconds relative to the timeline. |
| `endTime` | `number` | End time in seconds relative to the timeline. |
| `duration` | `number` | Duration of the clip in seconds. |
| `track` | `number` | Visual track number (1 or 2) for checkerboard layout. |
| `source` | `string` | Source of the clip: `main` (original audio) or `stem`. |
| `stemName` | `string` | If source is `stem`, the type of stem (e.g., `Drums`). |
| `status` | `string` | Generation status: `pending`, `generating`, `done`, `error`. |
| `notes` | `object` | Unified narrative data: `{ action, dialogue, sound }`. |
| `metadata` | `object` | Production props: `{ shotSize, cameraAngle, cameraMovement, paceWpm, actionNotes }`. |
| `videoPath` | `string` | (Optional) Absolute path to the active video take. |
| `videoTakes` | `Array<string>` | (Optional) List of all generated video versions for this clip. |
| `startImagePath` | `string` | (Optional) Reference image for the head of the shot. |
| `endImagePath` | `string` | (Optional) Reference image for the tail of the shot. |
| `paceWpm` | `number` | (Optional) Pacing benchmark in Words Per Minute (default: 150). |

---

### Element Tray Object (`elementTray[]`)

Stores references to characters, locations, or key technical constraints that can be tagged to clips.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier for the element. |
| `type` | `string` | Type of element: `character`, `location`, `prop`, `vfx`. |
| `name` | `string` | Display name of the entity. |
| `description`| `string` | Prompt snippet or description for AI generation context. |
| `icon` | `string` | (Optional) Icon or emoji for UI representation. |

---

**Example JSON Structure:**

```json
{
  "id": "project-1708329123456",
  "name": "My Cool Track",
  "audioPath": "C:\\Music\\my_cool_track.mp3",
  "outputDir": "C:\\Projects\\PRJ_My_Cool_Track",
  "frameRate": 24,
  "bpm": 128,
  "stems": [
    {
      "type": "Drums",
      "path": "C:\\Projects\\PRJ_My_Cool_Track\\my_cool_track_Drums.mp3",
      "color": "#ef4444",
      "markers": [
        { "timestamp": 0.418, "frame": 10, "color": "Red", "note": "Drums", "type": "beat", "duration_sec": 0.042 }
      ],
      "beats": [ 0.418, 0.859, 1.301, 1.742 ]
    },
    {
      "type": "Bass",
      "path": "C:\\Projects\\PRJ_My_Cool_Track\\my_cool_track_Bass.mp3",
      "color": "#f59e0b",
      "markers": [],
      "beats": [ 0.430, 0.871, 1.347 ]
    }
  ],
  "markers": [
    { "timestamp": 0.418, "frame": 10, "color": "Yellow", "note": "Main", "type": "beat", "duration_sec": 0.042 },
    { "timestamp": 0.859, "frame": 21, "color": "Yellow", "note": "Main", "type": "beat", "duration_sec": 0.042 }
  ],
  "clips": [
    {
      "id": "1708329987654",
      "label": "clip_0",
      "startTime": 0,
      "endTime": 4.5,
      "duration": 4.5,
      "track": 1,
      "source": "main",
      "status": "done",
      "notes": {
        "action": "A wide cinematic shot of a sunset",
        "dialogue": "Hello world",
        "sound": "Wind blowing"
      },
      "metadata": {
        "shotSize": "WS",
        "cameraAngle": "High Angle",
        "cameraMovement": "Pan"
      },
      "videoPath": "C:\\Projects\\PRJ_My_Cool_Track\\clip_0.mp4",
      "videoTakes": ["C:\\Projects\\PRJ_My_Cool_Track\\clip_0.mp4"]
    }
  ],
  "createdAt": "2026-02-24T21:37:41.306Z",
  "updatedAt": "2026-02-24T23:41:56.208Z"
}
```
