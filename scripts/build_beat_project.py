#!/usr/bin/env python
"""
Beat Project Builder for DaVinci Resolve

Imports audio, creates timeline, and applies beat markers in one step.
This ensures frame rate consistency between CSV calculations and timeline.

Usage:
    python build_beat_project.py <audio_path> <csv_path>

Requirements:
    - DaVinci Resolve running with a project open
    - External Scripting set to "Local" in Preferences
"""

import csv
import sys
import os

from resolve_utils import get_resolve, VALID_COLORS


def build_beat_project(audio_path, csv_path):
    """
    Complete workflow: Import audio → Create timeline → Apply markers

    Args:
        audio_path: Path to audio file (WAV, MP3, etc.)
        csv_path: Path to CSV with columns: frame, timestamp, color, note
    """
    # Validate files
    if not os.path.exists(audio_path):
        print(f"ERROR: Audio file not found: {audio_path}")
        sys.exit(1)

    if not os.path.exists(csv_path):
        print(f"ERROR: CSV file not found: {csv_path}")
        sys.exit(1)

    # Connect to Resolve
    print("Connecting to DaVinci Resolve...")
    resolve = get_resolve()

    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject()

    if not project:
        print("ERROR: No project is open in Resolve.")
        sys.exit(1)

    print(f"Project: {project.GetName()}")
    media_pool = project.GetMediaPool()

    # --- STEP 1: IMPORT AUDIO ---
    print(f"\n[1/3] Importing audio: {os.path.basename(audio_path)}")
    new_clips = media_pool.ImportMedia([audio_path])

    if not new_clips:
        print("ERROR: Failed to import media.")
        sys.exit(1)

    audio_clip = new_clips[0]
    print(f"      Imported: {audio_clip.GetName()}")

    # --- STEP 2: CREATE TIMELINE ---
    print(f"\n[2/3] Creating timeline...")
    timeline_name = f"Beat_Analysis_{os.path.splitext(os.path.basename(audio_path))[0]}"
    timeline = media_pool.CreateTimelineFromClips(timeline_name, [audio_clip])

    if not timeline:
        print("ERROR: Failed to create timeline.")
        sys.exit(1)

    # Get FPS from the new timeline
    fps = float(timeline.GetSetting("timelineFrameRate"))
    print(f"      Timeline: {timeline_name}")
    print(f"      Frame Rate: {fps} fps")

    # --- STEP 3: APPLY MARKERS ---
    print(f"\n[3/3] Applying markers from CSV...")

    markers_added = 0

    with open(csv_path, 'r', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            try:
                # Support both frame-based and timestamp-based CSVs
                if 'frame' in row:
                    frame_number = int(row['frame'])
                else:
                    timestamp = float(row['timestamp'])
                    frame_number = int(timestamp * fps)

                color = row.get('color', 'Blue').strip()
                if color not in VALID_COLORS:
                    color = 'Blue'

                note = row.get('note', 'beat').strip()

                timeline.AddMarker(frame_number, color, "Beat", note, 1)
                markers_added += 1

            except Exception as e:
                print(f"      Warning: Skipped row - {e}")

    # --- DONE ---
    print(f"\n{'='*50}")
    print(f"SUCCESS!")
    print(f"  Audio imported: {os.path.basename(audio_path)}")
    print(f"  Timeline created: {timeline_name}")
    print(f"  Markers applied: {markers_added}")
    print(f"{'='*50}")

    return True


def main():
    if len(sys.argv) < 3:
        print("Usage: python build_beat_project.py <audio_path> <csv_path>")
        print("\nExample:")
        print("  python build_beat_project.py C:\\Music\\song.wav C:\\Music\\song_beats.csv")
        sys.exit(1)

    audio_path = sys.argv[1]
    csv_path = sys.argv[2]

    build_beat_project(audio_path, csv_path)


if __name__ == "__main__":
    main()
