#!/usr/bin/env python3
"""
MiniMax H3 Prompt Validator Script
Validates prompt files against H3 best practices and rule constraints.
"""

import sys
# Safe Windows console UTF-8 reconfig
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

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

    # Rule 1.5: Check forbidden intra-shot action timecodes (e.g. 'At 00:10:00,', 'From 00:12:00', 'At 00:08.000', 'at 00:04')
    # NOTE: Standard shot duration ranges (e.g. '00:00.000–00:05.000 [Shot description]') are valid and supported.
    # What fails in diffusion is injecting mid-shot actions at fixed times using 'at' or 'from'.
    forbidden_timecodes = re.findall(
        r'\b(?:at|from)\s+(?:00:\d{2}[:\.]\d{2,3}|00:\d{2}:\d{2}|\d{2}:\d{2}:\d{2})\b|'
        r'\b(?:at|from)\s+00:\d{2}\b',
        content,
        re.IGNORECASE
    )
    if forbidden_timecodes:
        errors.append(f"Forbidden intra-shot action timecodes found: {forbidden_timecodes}. MiniMax H3 cannot hit mid-take action cues at fixed clock positions. Replace 'at'/'from' action triggers with event-driven transitions (e.g. 'As the subject turns...', 'Midway through the take...', 'Upon reaching the mark...'). Note: Standard shot boundary ranges (e.g. '00:00.000–00:05.000') remain fully valid.")

    # Check format type
    is_six_section = "subject_definitions:" in content.lower() and "retention_analysis:" in content.lower()
    is_playbook = "playbook" in content.lower()
    is_microbeat = "invariance contract" in content.lower() or "micro-beat" in content.lower()
    is_inpainting = "video editing" in content.lower() or "inpainting" in content.lower() or "<video 1>" in content.lower()

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
    if is_playbook:
        missing_parts = set(playbook_parts) - set(found_parts)
        if missing_parts:
            warnings.append(f"Missing 8-Part Playbook sections: {list(missing_parts)}")

    # Rule 2.1: Check for 6-Section Reference / Inpainting format
    six_section_parts = [
        "subject_definitions:",
        "summary:",
        "retention_analysis:",
        "detailed_description:",
        "overall_soundscape:",
        "non_diegetic_music:"
    ]
    if is_six_section:
        missing_six_parts = [p for p in six_section_parts if p not in content.lower()]
        if missing_six_parts:
            warnings.append(f"Missing 6-Section Reference format parts: {missing_six_parts}")
        
        # Check dual-input requirement for inpainting / video editing
        if is_inpainting:
            has_video_ref = bool(re.search(r'(<Video \d+>|ref_video_0|Video 1)', content, re.IGNORECASE))
            has_image_ref = bool(re.search(r'(<Picture \d+>|ref_image_0|Image 1|<Subject \d+>)', content, re.IGNORECASE))
            if not has_video_ref or not has_image_ref:
                errors.append("Ref2VA Inpainting / Video Editing requires dual-input reference mapping: both source video (<Video 1>/ref_video_0) and reference image/subject (<Picture 1>/ref_image_0) must be defined.")

    # Rule 3: Check for reference asset notation if references are mentioned
    is_pure_t2v = bool(re.search(r'\b(pure text-to-video|pure t2v|none\b.*attached|no attached assets|zero attached assets)\b', content, re.IGNORECASE))
    if any(k in content.lower() for k in ["reference", "image 1", "picture 1", "video 1"]) and not is_six_section and not is_pure_t2v:
        if not re.search(r'(Image \d+|<Picture \d+>|Video \d+|<Video \d+>|Audio \d+|<Audio \d+>)', content, re.IGNORECASE):
            warnings.append("Reference assets mentioned but standard tags (e.g. 'Image 1', '<Picture 1>', 'Video 1') were not found.")

    # Rule 4: Check for Sound Clause and relative or duration cues (unless in 6-section mode with N/A)
    if ("sound" in content.lower() or "audio" in content.lower()) and not is_six_section:
        if not re.search(r'(\[\d+s|\d+\s*seconds|\d+-\d+s|on impact|during|throughout|continuous|foley|ambience|dialogue)', content, re.IGNORECASE):
            warnings.append("Sound section found, but no relative action cues or duration brackets (e.g. '[0s-5s]', '[On impact]', or '[During camera move]') detected.")
            
    # Rule 4.5: Check for quoted dialogue & flag obsolete <d> tags
    if "<d>" in content or "</d>" in content:
        warnings.append("<d>...</d> tags are unreliable in MiniMax H3. Revert to standard double quotes for spoken dialogue and lyrics (e.g. Character says, \"exact words\").")

    if re.search(r'\b(dialogue|speaks|says|shouts|spoken|lyrics)\b', content, re.IGNORECASE):
        if not re.search(r'["\'].*?["\']', content):
            warnings.append("Dialogue or spoken lyrics were mentioned, but no text was found enclosed in standard quotes (\"...\").")


    # Rule 5: Check for Negative Directions / Constraints / Limits / Invariance
    if not any(k in content.lower() for k in ["negative", "no morphing", "no subtitles", "no watermarks", "no extra limbs", "limits", "prohibited", "retention_analysis", "invariance"]):
        warnings.append("No explicit Negative Directions / Limits / Retention Analysis found. Add negative constraints or retention boundaries to prevent morphing or visual artifacts.")

    # Rule 6: Check for conflicting optical styles
    has_hyper_sharp = bool(re.search(r'\b(hyper-?realistic anime|razor-?sharp digital 4k|clean digital 8k|ultra-sharp cgi)\b', content, re.IGNORECASE))
    has_vintage_aberration = bool(re.search(r'\b(vintage lens distortion|chromatic aberration|1970s photography|vhs filter|scanlines)\b', content, re.IGNORECASE))
    if has_hyper_sharp and has_vintage_aberration:
        warnings.append("Conflicting visual styles detected: mixing hyper-sharp digital/anime rendering with vintage optical degradation (chromatic aberration, VHS, or film grain) creates muddy AI diffusion artifacts.")

    # Summary
    print(f"=== MiniMax H3 Prompt Validation Report for '{file_path}' ===")
    if is_six_section:
        print("Format: 6-Section Reference / Ref2VA Inpainting")
    elif is_playbook:
        print(f"Format: 8-Part Playbook ({len(found_parts)}/8 sections found)")
    elif is_microbeat:
        print("Format: Grounded Micro-Beat Cinematic")
    else:
        print("Format: Standard / 5-Block")

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
