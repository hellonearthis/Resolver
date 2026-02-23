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
| `stemType` | `string` | The type of source audio (e.g., `original`, `vocals`, `drums`). |
| `stems` | `Array` | List of separated stem tracks (see *Stems Object*). |
| `markers` | `Array` | List of detected events (beats, onsets) (see *Markers Object*). |
| `clips` | `Array` | List of video segments created in the timeline (see *Clips Object*). |
| `createdAt` | `string` | ISO timestamp of creation. |
| `updatedAt` | `string` | ISO timestamp of last update. |

### Stems Object (`stems`)

Contains information about separated audio tracks (e.g., from Demucs separation).

| Field | Type | Description |
| :--- | :--- | :--- |
| `type` | `string` | Stem type (e.g., `vocals`, `drums`, `bass`, `other`). |
| `path` | `string` | Absolute path to the stem audio file. |
| `color` | `string` | Hex color code assigned to this stem for UI visualization. |
| `beats` | `Array<number>` | (Optional) Array of beat timestamps specific to this stem. |

### Markers Object (`markers`)

Represents analysis points like beats or onsets.

| Field | Type | Description |
| :--- | :--- | :--- |
| `timestamp` | `number` | Time in seconds where the marker occurs. |
| `type` | `string` | Type of marker: `beat`, `onset`, or `loudness`. |
| `color` | `string` | RGBA color string for visualization. |
| `note` | `string` | Optional label or note for the marker. |

### Clips Object (`clips`)

Represents the video segments arranged in the **Music Video Assembler**.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique ID for the clip. |
| `label` | `string` | Display name of the clip in the timeline. |
| `startTime` | `number` | Start time in seconds relative to the timeline. |
| `endTime` | `number` | End time in seconds relative to the timeline. |
| `duration` | `number` | Duration of the clip in seconds. |
| `track` | `number` | Visual track number (1 or 2) for checkerboard layout. |
| `source` | `string` | Source of the clip: `main` (original audio) or `stem`. |
| `stemName` | `string` | If source is `stem`, the type of stem (e.g., `drums`). |
| `status` | `string` | Generation status: `pending`, `generating`, `done`, `error`. |
| `videoPath` | `string` | (Optional) Absolute path to the generated video file. |
| `startImagePath` | `string` | (Optional) Path to the *Start Image* used for morph/transition reference. |
| `endImagePath` | `string` | (Optional) Path to the *End Image* used for morph/transition reference. |
| `promptText` | `string` | (Optional) The text prompt used for generative video creation. |

---

**Example JSON Structure:**

```json
{
  "id": "project-1708329123456",
  "name": "My Cool Track",
  "audioPath": "C:\\Music\\my_cool_track.mp3",
  "outputDir": "C:\\Projects\\PRJ_My_Cool_Track",
  "bpm": 128,
  "stems": [
    { "type": "vocals", "path": "...", "color": "#3b82f6" },
    { "type": "drums", "path": "...", "color": "#ef4444" }
  ],
  "clips": [
    {
      "id": "1708329987654",
      "label": "Intro_01",
      "startTime": 0,
      "endTime": 4.5,
      "source": "main",
      "status": "done",
      "videoPath": "C:\\Projects\\PRJ_My_Cool_Track\\Intro_01.mp4"
    }
  ]
}
```
