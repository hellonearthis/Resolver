"""
example_add_beat_markers.py
----------------------------
Example: take beat-marker JSON and push it directly onto the current
DaVinci Resolve timeline as real markers -- driven entirely from an external
Python script via resolve_bridge.py.
"""

import json
import os
from resolve_client import ResolveBridge

# WHAT: Default token matches resolve_bridge.py and Resolver application.
BRIDGE_TOKEN = os.environ.get("RESOLVER_BRIDGE_TOKEN", "resolver-local-bridge-key")

# WHAT: Stand-in sample for beat analysis output.
SAMPLE_PIPELINE_MARKERS = {
    "bpm": 128,
    "beat_markers": [
        {"time_seconds": 0.94, "label": "kick_downbeat", "color": "Red"},
        {"time_seconds": 1.41, "label": "kick_beat", "color": "Yellow"},
        {"time_seconds": 1.88, "label": "vocal_onset", "color": "Cyan"},
        {"time_seconds": 2.35, "label": "snare", "color": "Green"},
    ],
}


def seconds_to_frames(seconds, fps):
    return int(round(seconds * fps))


def main():
    print("Connecting to DaVinci Resolve via HTTP Bridge...")
    rb = ResolveBridge(token=BRIDGE_TOKEN)

    # Health check
    status = rb.ping()
    if not status.get("ok"):
        print("ERROR: Could not connect to resolve_bridge.py.")
        print("Please ensure DaVinci Resolve is open and run:")
        print("  Workspace > Scripts > Utility > resolve_bridge")
        return

    print(f"Connected! Resolve Version: {status.get('version')}")

    project_manager = rb.root.GetProjectManager()
    project = project_manager.GetCurrentProject()
    if not project:
        print("ERROR: No project open in DaVinci Resolve. Please open a project first.")
        return

    print(f"Active Project: {project.GetName()}")

    timeline = project.GetCurrentTimeline()
    if timeline is None:
        print("ERROR: No current timeline open in Resolve. Please create or open a timeline.")
        return

    fps = float(timeline.GetSetting("timelineFrameRate") or 24.0)
    start_frame = int(timeline.GetStartFrame() or 0)
    print(f"Timeline: {timeline.GetName()} ({fps} fps, StartFrame: {start_frame})")

    print(f"Pushing {len(SAMPLE_PIPELINE_MARKERS['beat_markers'])} markers...")
    added_count = 0
    for marker in SAMPLE_PIPELINE_MARKERS["beat_markers"]:
        frame_id = start_frame + seconds_to_frames(marker["time_seconds"], fps)
        success = timeline.AddMarker(
            frame_id,
            marker.get("color", "Blue"),
            marker["label"],
            json.dumps({"bpm": SAMPLE_PIPELINE_MARKERS["bpm"], "time": marker["time_seconds"]}),
            1,  # duration in frames
        )
        if success:
            added_count += 1
            print(f"  [OK] Added {marker['color']} marker '{marker['label']}' at frame {frame_id}")

    print(f"Done! Successfully placed {added_count} markers on the timeline.")


if __name__ == "__main__":
    main()
