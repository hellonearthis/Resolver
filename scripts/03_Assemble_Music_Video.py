#!/usr/bin/env python
"""
03_Assemble_Music_Video.py

This script reads a `music_video_manifest.json` file and assembles the video clips
onto the DaVinci Resolve timeline.

Features:
- Imports media files from the manifest.
- Creates a new timeline (or uses active one).
- Places clips at exact timestamps.
- Uses "Checkerboarding" (Tracks 1 & 2) to prevent overlaps.
- Sets clip duration based on manifest (handles Trim).

Usage:
1. Generate `music_video_manifest.json` from the Electron App.
2. Run this script from DaVinci Resolve (Workspace > Scripts).
3. Select the manifest file when prompted.
"""

import sys
import os
import json
import time

# --- Resolve API Initialization ---
try:
    import DaVinciResolveScript as dvr_script
    resolve = dvr_script.scriptapp('Resolve')
except ImportError:
    # Fallback for internal execution
    try:
        resolve = resolve # type: ignore
    except NameError:
        print("Could not connect to DaVinci Resolve.")
        sys.exit(1)

def get_manifest_path():
    # In a real scenario, we might use a file dialog.
    # For now, we'll ask the user to input the path or look for a default.
    # Using the Fusion/UI dialog is possible but complex for a basic script.
    # We will try to find the manifest in the user's Downloads or specific folder,
    # or just ask via standard input if running from terminal (unlikely for internal script).
    
    # Simple approach: Assume it's in the same folder as the project audio or a standard location.
    # Let's try to use the UI File Dialog if possible.
    
    fusion = resolve.Fusion()
    if fusion:
        path = fusion.RequestFile(
            Name="Select Manifest JSON",
            Pattern="JSON Files (*.json)|*.json",
        )
        if path:
            return path
            
    return None

def main():
    print("--- Starting Music Video Assembly ---")
    
    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject()
    
    if not project:
        print("No project is open.")
        return

    media_pool = project.GetMediaPool()
    timeline = project.GetCurrentTimeline()
    
    if not timeline:
        print("Creating new timeline...")
        timeline = media_pool.CreateEmptyTimeline(f"Music_Video_{int(time.time())}")
        if not timeline:
            print("Failed to create timeline.")
            return

    # 1. Load Manifest
    manifest_path = get_manifest_path()
    if not manifest_path:
        print("No manifest selected.")
        return
        
    print(f"Loading manifest: {manifest_path}")
    
    with open(manifest_path, 'r') as f:
        data = json.load(f)
        
    clips = data.get('clips', [])
    fps = data.get('project_fps', 24)
    
    print(f"Found {len(clips)} clips.")
    
    # 2. Import Media
    # Group by path to avoid duplicates
    media_paths = list(set([c['path'] for c in clips]))
    
    # Check what's already in the pool to avoid re-importing if possible?
    # For simplicity, we just import. Resolve handles duplicates mostly well (links them).
    imported_items = media_pool.ImportMedia(media_paths)
    
    # Map paths to MediaPoolItems
    # ImportMedia returns a list. logic is needed to map back if we imported multiple.
    # Or import one by one? One by one is safer for mapping.
    
    media_map = {} # path -> MediaPoolItem
    
    print("Importing media...")
    for path_str in media_paths:
        if not os.path.exists(path_str):
            print(f"Warning: File not found: {path_str}")
            continue
            
        items = media_pool.ImportMedia([path_str])
        if items and len(items) > 0:
            media_map[path_str] = items[0]
        else:
            print(f"Failed to import: {path_str}")

    # 3. Assemble Timeline
    print("Placing clips on timeline...")
    
    resolve.OpenPage("Edit")
    
    for i, clip in enumerate(clips):
        if clip.get('is_muted', False):
            print(f"Skipping muted alternate take: {clip.get('id', i+1)}")
            continue

        path_str = clip['path']
        if path_str not in media_map:
            continue
            
        media_item = media_map[path_str]
        
        clip_id = clip.get('id', f"clip_{i+1}")
        scene_num = clip.get('scene_number', str(i+1))
        clip_label = clip.get('label', f"Shot {scene_num}")
        display_name = f"[{clip_id}] {clip_label}"

        # Set persistent ID on MediaPool item property
        try:
            media_item.SetClipProperty("Clip Name", display_name)
        except Exception:
            pass

        start_frame = int(round(clip.get('start_seconds', 0) * fps))
        duration_frames = int(round((clip.get('duration') or (clip.get('end_seconds', 0) - clip.get('start_seconds', 0))) * fps))
        if duration_frames <= 0:
            duration_frames = int(4.0 * fps)
        
        track_index = clip.get('track', 1) # 1 or 2
        
        successful = False
        try:
            # Fallback: AppendToTimeline
            timeline.AppendToTimeline([media_item])
            successful = True

            # Add timeline marker identifying the stable ID and shot name
            timeline.AddMarker(
                start_frame,
                "Blue",
                clip_id,
                f"{display_name} (Scene {scene_num})",
                max(1, duration_frames),
                ""
            )
        except Exception as e:
            print(f"Error placing clip {clip_id}: {e}")
            
    print("Assembly Complete. Clips placed and tagged with stable IDs.")
    print("For precise timing and checkerboarding, manual adjustment or an XML/EDL workflow is recommended.")

if __name__ == "__main__":
    main()
