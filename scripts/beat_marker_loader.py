#!/usr/bin/env python
"""
Beat Marker Loader for DaVinci Resolve

Imports beat timestamps from a CSV file and adds them as markers
to the current timeline in DaVinci Resolve.

CSV Format:
    timestamp,color,note
    1.245,Red,Kick
    2.450,Yellow,Snare

Usage:
    python beat_marker_loader.py <csv_path>

Requirements:
    - DaVinci Resolve running with a project/timeline open
    - External Scripting set to "Local" in Resolve Preferences
"""

import sys
import csv
import os

from resolve_utils import get_resolve, VALID_COLORS


def import_beats_to_resolve(csv_path, marker_name="Beat"):
    """
    Read CSV file and add markers to current timeline.

    Args:
        csv_path: Path to CSV file with columns: timestamp, color, note
        marker_name: Default name for markers
    """
    # Validate CSV exists
    if not os.path.exists(csv_path):
        print(f"ERROR: CSV file not found: {csv_path}")
        sys.exit(1)

    # Connect to Resolve
    print("Connecting to DaVinci Resolve...")
    resolve = get_resolve()

    # Get current project
    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject()

    if not project:
        print("ERROR: No project is open in Resolve.")
        sys.exit(1)

    print(f"Project: {project.GetName()}")

    # Get current timeline
    timeline = project.GetCurrentTimeline()

    if not timeline:
        print("ERROR: No timeline is active.")
        print("Please select a timeline in Resolve before running this script.")
        sys.exit(1)

    print(f"Timeline: {timeline.GetName()}")

    # Get timeline frame rate
    fps_str = project.GetSetting("timelineFrameRate")
    try:
        fps = float(fps_str)
    except (ValueError, TypeError):
        fps = 24.0
        print(f"Warning: Could not determine FPS, using default {fps}")

    print(f"Frame Rate: {fps} fps")

    # Read CSV and add markers
    markers_added = 0
    markers_failed = 0

    print("\nImporting markers...")

    with open(csv_path, 'r', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            try:
                # Parse timestamp
                timestamp = float(row.get('timestamp', 0))

                # Parse color (default to Blue)
                color = row.get('color', 'Blue').strip()
                if color not in VALID_COLORS:
                    color = 'Blue'

                # Parse note
                note = row.get('note', marker_name).strip()

                # Convert seconds to frames
                frame_number = int(timestamp * fps)

                # Add marker
                success = timeline.AddMarker(
                    frame_number,    # Frame ID
                    color,           # Color
                    marker_name,     # Name
                    note,            # Note/Comment
                    1                # Duration in frames
                )

                if success:
                    markers_added += 1
                else:
                    markers_failed += 1

            except Exception as e:
                print(f"Warning: Failed to add marker at row: {row}. Error: {e}")
                markers_failed += 1

    # Report results
    print(f"\n{'='*40}")
    print(f"Import Complete!")
    print(f"  Markers added: {markers_added}")
    if markers_failed > 0:
        print(f"  Markers failed: {markers_failed}")
    print(f"{'='*40}")

    return markers_added


def main():
    if len(sys.argv) < 2:
        print("Usage: python beat_marker_loader.py <csv_path>")
        print("\nCSV Format:")
        print("  timestamp,color,note")
        print("  1.245,Red,Kick")
        print("  2.450,Yellow,Snare")
        sys.exit(1)

    csv_path = sys.argv[1]
    import_beats_to_resolve(csv_path)


if __name__ == "__main__":
    main()
