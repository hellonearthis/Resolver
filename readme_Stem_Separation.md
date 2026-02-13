# Stem Separation with ComfyUI

This module allows you to split an audio file into 4 separate stems (Drums, Bass, Vocals, Other) using a local installation of ComfyUI.

## Prerequisites

1.  **ComfyUI Installed & Running**:
    -   You must have [ComfyUI](https://github.com/comfyanonymous/ComfyUI) installed.
    -   It must be running locally on the default port: `http://127.0.0.1:8188`.
    -   You need the **Audio-Loading-Nodes** (or equivalent) custom nodes installed in ComfyUI to support the `LoadAudio` and `SaveAudio` nodes used in the workflow.

2.  **Workflow File**:
    -   The application uses a bundled workflow: `comfyui_workflows/Extract_Stems.json`.
    -   This workflow uses the `htdemucs` model (or similar) for separation.

## Usage

1.  **Launch ComfyUI**: Start your ComfyUI server/bat file.
    -   The app will show a green **"ComfyUI: Connected"** badge in the Stem Separation tab.

2.  **Select Audio**:
    -   Drag and drop an MP3, WAV, or FLAC file into the "Audio File" dropzone.

3.  **Choose Output Folder**:
    -   Click "Output Folder" to select where the separated stems should be saved.
    -   *Note: Standard ComfyUI nodes often save to the `ComfyUI/output` folder by default. The app attempts to prefix filenames to help you find them, but you may need to check the ComfyUI output directory if custom paths are not supported by your specific ComfyUI nodes.*

4.  **Separate Stems**:
    -   Click **"🚀 Separate Stems"**.
    -   The request is sent to ComfyUI.
    -   Once complete, the **Stem Player** will appear.

5.  **Preview & Analyze**:
    -   **Multi-Track Preview**: Use the **Play All** button to listen to all stems synchronized.
    -   **Analyze Stems**: Click the colored **Analyze** buttons (e.g., "Analyze Drums", "Analyze Vocals") to detect beats for that specific stem.
    -   **Cached Results**: If you've already analyzed a stem, the results (white beat markers) will load **instantly** without re-processing.
    -   **Embedded View**: The beat detection UI opens directly within the Stem Separation module, allowing you to configure settings (Onsets, Loudness) and export markers without leaving the workflow.

## Output Filenames

The generated files will be named using the pattern:
```
[OriginalFilename]_[StemType]_[BatchNumber]_.flac
```
Example: `MySong_drums_00001_.flac`

## Troubleshooting

-   **"ComfyUI: Disconnected"**: Ensure ComfyUI is running and accessible at `http://127.0.0.1:8188`. Check firewall settings.
-   **"Workflow file not found"**: Ensure `comfyui_workflows/Extract_Stems.json` exists in the application root/resources.
-   **Execution Error**: Check the ComfyUI console window for python errors (e.g., missing models, missing custom nodes).
