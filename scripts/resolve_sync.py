#!/usr/bin/env python
"""
Resolve Sync — Imports audio + video, creates timeline, and places clips on beats.

Usage:
    python resolve_sync.py <data_file_path>

The data file is a JSON object with keys: audioPath, videoPaths, beats.
"""

import sys
import json
import os

from resolve_utils import get_resolve


def main():
    if len(sys.argv) < 2:
        print("Usage: python resolve_sync.py <data_file_path>")
        sys.exit(1)

    data_file_path = sys.argv[1]

    try:
        with open(data_file_path, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Failed to read data file: {e}")
        sys.exit(1)

    audio_path = data.get('audioPath')
    video_paths = data.get('videoPaths', [])
    beats = data.get('beats', [])  # List of timestamps in seconds

    if not audio_path or not video_paths:
        print("Missing audio or video paths.")
        sys.exit(1)

    print("Connecting to DaVinci Resolve...")
    resolve = get_resolve()

    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject()

    if not project:
        print("No project is open. Please open a project in Resolve.")
        sys.exit(1)

    media_pool = project.GetMediaPool()
    root_folder = media_pool.GetRootFolder()

    # Create a bin for our import
    import_bin = media_pool.AddSubFolder(root_folder, "BeatSync_Import")
    media_pool.SetCurrentFolder(import_bin)

    print("Importing media...")
    # Import Audio
    audio_items = media_pool.ImportMedia([audio_path])
    if not audio_items:
        print("Failed to import audio.")
        sys.exit(1)
    audio_item = audio_items[0]

    # Import Videos
    video_items = media_pool.ImportMedia(video_paths)
    if not video_items:
        print("Failed to import videos.")
        sys.exit(1)

    print(f"Imported {len(video_items)} video clips.")

    # Create Timeline
    timeline_name = f"BeatSync_{os.path.basename(audio_path)}"
    print(f"Creating timeline: {timeline_name}")

    timeline = media_pool.CreateEmptyTimeline(timeline_name)
    if not timeline:
        print("Failed to create timeline.")
        sys.exit(1)

    project.SetCurrentTimeline(timeline)
    media_pool.AppendToTimeline([audio_item])

    # Get timeline frame rate
    frame_rate = timeline.GetSetting("timelineFrameRate")
    print(f"Timeline Frame Rate: {frame_rate}")

    try:
        fps = float(frame_rate)
    except (ValueError, TypeError):
        fps = 24.0  # Fallback

    print(f"Using FPS: {fps}")

    # Build video segments from beat timestamps
    points = [0.0] + beats
    video_index = 0

    for i in range(len(points) - 1):
        if video_index >= len(video_items):
            video_index = 0  # Loop videos

        start_time = points[i]
        end_time = points[i + 1]
        duration_sec = end_time - start_time

        if duration_sec <= 0.04:  # Skip very short segments
            continue

        duration_frames = int(duration_sec * fps)
        current_video = video_items[video_index]

        clip_info = {
            "mediaPoolItem": current_video,
            "startFrame": 0,
            "endFrame": duration_frames - 1,
            "mediaType": 1  # Video only
        }

        media_pool.AppendToTimeline([clip_info])
        video_index += 1

    print("Sync complete.")


if __name__ == "__main__":
    main()
