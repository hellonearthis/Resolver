#!/usr/bin/env python3
"""
MiniMax H3 Prompt Validator Script
Validates prompt files against H3 best practices and rule constraints.
"""

import sys
import re
import argparse

def validate_h3_prompt(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file '{file_path}': {e}")
        return False

    errors = []
    warnings = []

    # Rule 1: Check forbidden bracketed camera parameters like [Push in: 2s] or [Zoom: 3s]
    forbidden_camera_brackets = re.findall(r'\[(?:Camera|Push|Pull|Zoom|Pan|Tilt|Orbit|Rack|Dolly)[^\]]*\]', content, re.IGNORECASE)
    if forbidden_camera_brackets:
        errors.append(f"Forbidden bracketed camera parameter syntax found: {forbidden_camera_brackets}. H3 requires natural language camera descriptions.")

    # Rule 2: Check for 8-Part Playbook components if labeled as Playbook
    playbook_parts = [
        "Reference Job Assignments",
        "Scene / Format / Mood",
        "One Dominant Action",
        "Camera Path & Framing",
        "Lighting & Palette",
        "Sound Clause",
        "Final Beat / Composition",
        "Negative Directions"
    ]
    
    found_parts = [part for part in playbook_parts if part.lower() in content.lower()]
    if "playbook" in content.lower():
        missing_parts = set(playbook_parts) - set(found_parts)
        if missing_parts:
            warnings.append(f"Missing 8-Part Playbook sections: {list(missing_parts)}")

    # Rule 3: Check for reference asset notation if references are mentioned
    if any(k in content.lower() for k in ["reference", "image 1", "picture 1", "video 1"]):
        if not re.search(r'(Image \d+|<Picture \d+>|Video \d+|<Video \d+>|Audio \d+|<Audio \d+>)', content, re.IGNORECASE):
            warnings.append("Reference assets mentioned but standard tags (e.g. 'Image 1', '<Picture 1>', 'Video 1') were not found.")

    # Rule 4: Check for Sound Clause and timestamps
    if "sound" in content.lower() or "audio" in content.lower():
        if not re.search(r'(\[\d+s|\d+\s*seconds|\d+-\d+s|\d+:\d+)', content, re.IGNORECASE):
            warnings.append("Sound section found, but no explicit timestamps (e.g. '[0s-5s]' or '[5 seconds]') detected for sound events.")
            
        bracketed = ' '.join(re.findall(r'\[(.*?)\]', content))
        time_nums = re.findall(r'(\d+)\s*(?:s|seconds)', bracketed, re.IGNORECASE)
        if any(int(t) > 10 for t in time_nums):
            errors.append("MiniMax H3 videos have a maximum length of 10 seconds. Found timestamps exceeding 10s.")
            
    # Rule 4.5: Check for quoted dialogue
    if re.search(r'\b(dialogue|speaks|says|shouts|spoken)\b', content, re.IGNORECASE):
        if not re.search(r'["\'].*?["\']', content):
            warnings.append("Dialogue or spoken words were mentioned, but no text was found enclosed in quotes (e.g. \"spoken text\"). H3 requires spoken words to be explicitly quoted.")

    # Rule 5: Check for Negative Directions / Constraints
    if not any(k in content.lower() for k in ["negative", "no morphing", "no subtitles", "no watermarks", "no extra limbs", "limits"]):
        warnings.append("No explicit Negative Directions / Limits section found. Add negative constraints to prevent morphing or visual artifacts.")

    # Summary
    print(f"=== MiniMax H3 Prompt Validation Report for '{file_path}' ===")
    print(f"Sections detected: {len(found_parts)}/8 playbook parts found.")

    if errors:
        print("\n[ERROR] Fixes required:")
        for err in errors:
            print(f"  - {err}")

    if warnings:
        print("\n[WARNING] Recommended fixes:")
        for warn in warnings:
            print(f"  - {warn}")

    if not errors and not warnings:
        print("\n[PASSED] Prompt adheres perfectly to MiniMax H3 guidelines!")
        return True
    elif not errors:
        print("\n[PASSED] (with warnings): Prompt is valid, consider addressing warnings for optimal generation.")
        return True
    else:
        print("\n[FAILED] Prompt contains structural errors.")
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate MiniMax H3 Prompts")
    parser.add_argument("--input-file", required=True, help="Path to markdown or text prompt file")
    args = parser.parse_args()

    success = validate_h3_prompt(args.input_file)
    sys.exit(0 if success else 1)
