# 🎬 Video Sync Module

The **Video Sync** module allows you to synchronize a collection of video clips to the beats of a music track in DaVinci Resolve.

## Important: Free Version vs Studio

- **Studio Version:** Supports full API access.
- **Free Version:** Does **not** support external API scripting.
  - To use this module with the **Free Version**, you must run the generated script manually from within Resolve.

## How to Use (Free Version Workflow)

1.  **Drop Music**: Drag and drop your audio file into the "1. Music" zone.
    - The app will analyze the audio to detect beats and BPM.

2.  **Drop Videos**: Drag and drop one or more video files into the "2. Videos" zone.
    - These are the clips you want to edit to the beat.

3.  **Generate Script**:
    - Click **Stage for Resolve** (or "Generate Script").
    - This creates a Python script (e.g., `02_Sync_Video.py`) in your Resolve Scripts folder:
      `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Comp\`
      *(The app automatically detects your system's ProgramData path)*

4.  **Run in Resolve**:
    - Open DaVinci Resolve.
    - Go to **Workspace > Scripts**.
    - Click **02_Sync_Video**.
    - The script will:
        - Create a new Timeline.
        - Import your Audio and Video files.
        - Sync clips to the detected beats.

## Troubleshooting

- **Script not showing up?**
  - Check the **Script Manager** in the dashboard to see if the file exists.
  - You may need to restart Resolve to refresh the scripts list.
- **Permission Errors?**
  - Ensure the dashboard app has write permissions to the Resolve Scripts folder.
  - Run as Administrator if necessary.
