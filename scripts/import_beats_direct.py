"""
import_beats_direct.py - Direct Beat Marker Importer for DaVinci Resolve

This script imports beat markers from a CSV file directly to the current timeline.
It trusts the frame data from your external app's calculations.

CSV Format (with headers):
    frame,timestamp,color,note
    30,1.245,Red,kick
    59,2.450,Yellow,snare

Usage:
    1. Open your project in DaVinci Resolve
    2. Open the Timeline where you want the markers
    3. Run: python import_beats_direct.py <path_to_csv>
"""

import csv
import sys
import os

# Attempt to load the Resolve API module
try:
    import DaVinciResolveScript as dvr_script
except ImportError:
    print("Error: Could not find DaVinciResolveScript module.")
    print("Make sure DaVinci Resolve is running and the scripting API is enabled.")
    sys.exit(1)

def import_beats_direct(csv_path):
    """Import beat markers from CSV to the current Resolve timeline."""
    
    # Validate CSV exists
    if not os.path.exists(csv_path):
        print(f"Error: CSV file not found: {csv_path}")
        return False
    
    # 1. Connect to Resolve
    resolve = dvr_script.scriptapp("Resolve")
    if not resolve:
        print("Error: Could not connect to Resolve. Is it running?")
        return False
        
    project = resolve.GetProjectManager().GetCurrentProject()
    
    if not project:
        print("Error: Please open a project in Resolve first.")
        return False

    timeline = project.GetCurrentTimeline()
    if not timeline:
        print("Error: Please open the target timeline.")
        return False

    # Visual confirmation of FPS (Just to be safe)
    fps = timeline.GetSetting("timelineFrameRate")
    print(f"Targeting Timeline at {fps} fps...")

    # 2. Read CSV and Stamp Markers
    print(f"Importing from: {csv_path}")
    
    with open(csv_path, 'r') as f:
        # Headers: frame, timestamp, color, note
        reader = csv.DictReader(f)
        
        count = 0
        for row in reader:
            # DIRECT MAPPING: Trusting your external app's math
            target_frame = int(row['frame'])
            marker_color = row['color'] 
            marker_note = row['note']
            
            # Add Marker (Frame, Color, Name, Note, Duration)
            timeline.AddMarker(target_frame, marker_color, "Beat", marker_note, 1)
            count += 1

    print(f"Success! {count} markers added.")
    return True

if __name__ == "__main__":
    if len(sys.argv) > 1:
        csv_file = sys.argv[1]
    else:
        # Default path - update this to your generated CSV
        csv_file = r"C:\Path\To\your_beat_file.csv"
        print(f"Usage: python {sys.argv[0]} <path_to_csv>")
        print(f"Using default path: {csv_file}")
    
    import_beats_direct(csv_file)
