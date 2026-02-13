#!/usr/bin/env python
"""
Advanced Marker Loader for DaVinci Resolve

Reads the extended CSV (with type & duration_sec columns) and applies markers
using the correct Resolve API strategy:

  type=beat   → Timeline marker (single frame)
  type=onset  → Clip-level marker on audio item in Track 1
  type=section / type=loudness → Timeline marker with duration

CSV Format:
    frame,timestamp,color,note,type,duration_sec
    30,1.250,Blue,beat,beat,0
    45,1.875,Red,onset,onset,0
    480,20.000,Yellow,High Energy,loudness,3.500

Usage:
    python advanced_marker_loader.py <csv_path>

Requirements:
    - DaVinci Resolve running with a project/timeline open
    - External Scripting set to "Local" in Resolve Preferences
"""

import csv
import sys
import os

from resolve_utils import get_resolve


def load_markers(csv_path):
    """Load markers from extended CSV and apply to Resolve timeline."""
    resolve = get_resolve()
    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    if not project:
        print("ERROR: No project open in Resolve.")
        sys.exit(1)

    timeline = project.GetCurrentTimeline()
    if not timeline:
        print("ERROR: No timeline selected in Resolve.")
        sys.exit(1)

    fps = float(timeline.GetSetting("timelineFrameRate"))
    print(f"Timeline: {timeline.GetName()}")
    print(f"Frame rate: {fps} fps")

    # Attempt to find audio clip on Track 1 for clip-level markers
    audio_item = None
    audio_track_count = int(timeline.GetTrackCount("audio"))
    if audio_track_count > 0:
        items = timeline.GetItemListInTrack("audio", 1)
        if items and len(items) > 0:
            audio_item = items[0]
            print(f"Audio clip found: {audio_item.GetName()}")

    stats = {"beat": 0, "onset": 0, "loudness": 0, "other": 0}

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            frame = int(row["frame"])
            color = row.get("color", "Blue")
            note = row.get("note", "")
            marker_type = row.get("type", "beat")
            duration_sec = float(row.get("duration_sec", "0"))

            # Duration in frames (minimum 1 for point markers)
            duration_frames = max(1, round(duration_sec * fps)) if duration_sec > 0 else 1

            if marker_type == "onset" and audio_item:
                # Clip-level marker on the audio item
                audio_item.AddMarker(
                    frame, color, note, note, duration_frames
                )
                stats["onset"] += 1

            elif marker_type in ("beat", "loudness", "section"):
                # Timeline-level marker
                timeline.AddMarker(
                    frame, color, note, note, duration_frames
                )
                stats[marker_type] = stats.get(marker_type, 0) + 1
            else:
                timeline.AddMarker(
                    frame, color, note, note, duration_frames
                )
                stats["other"] += 1

    print("\n--- Marker Import Complete ---")
    for mtype, count in stats.items():
        if count > 0:
            print(f"  {mtype}: {count} markers")
    print(f"  Total: {sum(stats.values())} markers")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python advanced_marker_loader.py <csv_path>")
        sys.exit(1)

    csv_path = sys.argv[1]
    if not os.path.exists(csv_path):
        print(f"ERROR: CSV file not found: {csv_path}")
        sys.exit(1)

    load_markers(csv_path)
