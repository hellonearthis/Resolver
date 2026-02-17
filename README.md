# DaVinci Resolve Production Dashboard

A modular production tool for DaVinci Resolve featuring **beat synchronization**, **stem separation**, and **marker automation** — powered by **Essentia.js** WASM-based audio analysis.

**GitHub Repository**: [https://github.com/hellonearthis/Resolver](https://github.com/hellonearthis/Resolver)

## Features

- 🎵 **[Beat Extraction](readme_Beat_Detection.md)** — Detect BPM and actual beat positions using Essentia.js
- 🎬 **[Video Assembler](readme_Video_Assembler.md)** — Sync video clips to specific stems (drums, bass) with "Snap to Beat"
- 🎬 **[Video Sync](readme_Video_Sync.md)** — Auto-sync video clips to the beat
- 📜 **[Script Manager](readme_Script_Manager.md)** — Manage generated Python scripts for Resolve
- 🎚️ **[Stem Separation](readme_Stem_Separation.md)** — Split tracks via ComfyUI with integrated Beat Analysis

## Documentation

- 📄 **[Beat Detection Guide](readme_Beat_Detection.md)** – Detailed guide on algorithms, onsets, and loudness.
- 📄 **[Video Assembler Guide](readme_Video_Assembler.md)** – How to use stems, zoom-sync, and checkerboard assembly.
- 📄 **[Video Sync Guide](readme_Video_Sync.md)** – How to sync clips to music.
- 📄 **[Script Manager Guide](readme_Script_Manager.md)** – managing your generated scripts.

## Architecture

```mermaid
flowchart TD
    Input[Song.mp3] --> App1

    subgraph App1["Production Dashboard"]
        WASM[Essentia.js WASM<br/>Audio Analysis]
        Comfy[ComfyUI Bridge<br/>Stem Separation]
        Assembler[Video Assembler<br/>Rhythmic Sequencing]
        WASM --> Assembler
        Comfy --> Assembler
    end

    subgraph Scripts["Python Automation"]
        Manifest[manifest.json]
        AssemblyScript[Assemble_Music_Video.py]
        SyncScript[resolve_sync.py]
    end

    subgraph Resolve["DaVinci Resolve"]
        Timeline[Automated Timeline<br/>Checkerboard Tracks]
        Markers[Timeline/Clip Markers]
    end

    Assembler --> Manifest --> AssemblyScript
    App1 --> SyncScript
    AssemblyScript --> Resolve
    SyncScript --> Resolve
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Launch the App

```bash
npm start
```
Or run `start-dashboard.bat` on Windows.

---

## DaVinci Resolve Setup

> ⚠️ **Required before running any integrations**

1. Open **DaVinci Resolve** → **Preferences**.
2. Go to **System** → **General**.
3. Set **External Scripting Using** to **Local**.
4. **Restart Resolve**.

### Environment Variables (Windows)
```
PYTHONPATH=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Modules\
```

### Check Your Version
Run the included checker to see if you have Studio (API enabled) or Free version:
```bash
python scripts/check_resolve_version.py
```

## Folder Structure

```
resolver/
├── electron/                  # Electron main process (IPC, window mgmt)
│   ├── main.ts                # Main entry point
│   └── preload.ts             # Context bridge
├── src/                       # React frontend
│   ├── modules/               # Feature-specific modules (BeatExtraction, VideoSync, etc.)
│   ├── components/            # Shared UI components
│   ├── services/              # Logic services (Essentia, etc.)
│   └── hooks/                 # React hooks
├── scripts/                   # Python scripts for DaVinci Resolve integration
│   ├── resolve_sync.py        # Video sync logic
│   ├── beat_marker_loader.py  # Marker import logic
│   └── ...
├── dist-electron/             # Compiled Electron code
└── dist/                      # Compiled React app
```

## Roadmap & Ideas

- [x] **Stem Separation**: Integrate ComfyUI to split audio into stems (drums, bass, vocals).
- [x] **Beat Analysis per Stem**: Analyze and visualize individual rhythmic layers.
- [x] **Video Assembler**: Specialized UI for multi-stem rhythmic syncing.
- [ ] **Tap Tempo**: Manual BPM adjustment for challenging tracks.
- [ ] **Beat Divisions**: Options for 1/2, 1/4, or double-time beat markers.
- [ ] **Clip Randomizer**: Mode to select random clips from a bin for quick montages.
- [ ] **Sync Progress**: Real-time progress bar for Resolve operations.
- [ ] **Section Boundaries**: Auto-detect verse/chorus transitions.
- [ ] **Batch Processing**: Analyze multiple audio files at once.

## License

MIT
