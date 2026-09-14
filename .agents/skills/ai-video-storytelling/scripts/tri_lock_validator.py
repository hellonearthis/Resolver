#!/usr/bin/env python3
"""
tri_lock_validator.py

A validation script for checking adherence to the Tri-Lock Continuity Invariance Standard
(Character-Lock, Environment-Lock, Style-Lock) across screenplays, project files, and universe registries.

Usage:
    python tri_lock_validator.py <path_to_markdown_file>
"""

import sys
import re
import os

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

CHAR_REGEX = re.compile(r'\[CHAR:([A-Za-z0-9_]+)\s*\|\s*([^\]]+)\]')
ENV_REGEX = re.compile(r'\[ENV:([A-Za-z0-9_]+)\s*\|\s*([^\]]+)\]')
STYLE_REGEX = re.compile(r'\[STYLE:([A-Za-z0-9_]+)\s*\|\s*([^\]]+)\]')

SPEAKER_REGEX = re.compile(r'^SPEAKER:\s*\[CHAR:([A-Za-z0-9_]+)\]', re.IGNORECASE)
ACTION_REGEX = re.compile(r'^ACTION:', re.IGNORECASE)
LINE_REGEX = re.compile(r'^LINE:\s*["\']', re.IGNORECASE)

def validate_char_block(char_id, fields_str, line_num):
    errors = []
    fields = [f.strip() for f in fields_str.split('|')]
    field_keys = set()
    for f in fields:
        if ':' in f:
            k, v = f.split(':', 1)
            field_keys.add(k.strip())

    # Shot-level invocation reference (e.g. [CHAR:ID] or [CHAR:ID | current_emotion:... | arc_stage:...])
    if len(fields) <= 1 or ('role' not in field_keys and 'voice' not in field_keys):
        return errors

    required_keys = {'role', 'voice', 'current_emotion', 'arc_stage'}
    missing = required_keys - field_keys
    if missing:
        errors.append(f"Line {line_num}: [CHAR:{char_id}] missing required keys: {', '.join(missing)}")
    return errors

def validate_env_block(env_id, fields_str, line_num):
    errors = []
    fields = [f.strip() for f in fields_str.split('|')]
    field_keys = set()
    for f in fields:
        if ':' in f:
            k, v = f.split(':', 1)
            field_keys.add(k.strip())

    # Shot-level state reference (e.g. [ENV:ID | state:trigger:event])
    if 'state' in field_keys:
        return errors

    required_keys = {'type', 'fixed_geometry', 'fixed_palette', 'fixed_props', 'lighting_baseline'}
    missing = required_keys - field_keys
    if missing:
        errors.append(f"Line {line_num}: [ENV:{env_id}] missing required fixed fields: {', '.join(missing)}")
    return errors

def validate_style_block(style_id, fields_str, line_num):
    errors = []
    fields = [f.strip() for f in fields_str.split('|')]
    field_keys = set()
    for f in fields:
        if ':' in f:
            k, v = f.split(':', 1)
            field_keys.add(k.strip())

    # Shot-level modifier reference (e.g. [STYLE:ID | modifier:beat_name] or [STYLE:ID])
    if 'modifier' in field_keys or len(fields) <= 1:
        return errors

    required_keys = {'render', 'palette', 'linework', 'lighting_treatment', 'grain/finish'}
    missing = required_keys - field_keys
    if missing:
        errors.append(f"Line {line_num}: [STYLE:{style_id}] missing required style fields: {', '.join(missing)}")
    return errors

def validate_file(filepath):
    if not os.path.exists(filepath):
        print(f"Error: File not found: {filepath}")
        return False

    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    all_errors = []
    declared_chars = set()
    declared_envs = set()
    declared_styles = set()

    in_dialogue_block = False
    expect_action = False
    expect_line = False
    last_speaker_line = 0

    for idx, raw_line in enumerate(lines):
        line_num = idx + 1
        line = raw_line.strip()

        # Check CHAR blocks
        for match in CHAR_REGEX.finditer(line):
            cid, cfields = match.groups()
            declared_chars.add(cid)
            errs = validate_char_block(cid, cfields, line_num)
            all_errors.extend(errs)

        # Check ENV blocks
        for match in ENV_REGEX.finditer(line):
            eid, efields = match.groups()
            declared_envs.add(eid)
            errs = validate_env_block(eid, efields, line_num)
            all_errors.extend(errs)

        # Check STYLE blocks
        for match in STYLE_REGEX.finditer(line):
            sid, sfields = match.groups()
            declared_styles.add(sid)
            errs = validate_style_block(sid, sfields, line_num)
            all_errors.extend(errs)

        # Check Dialogue Sequence (SPEAKER -> ACTION -> LINE)
        spk_match = SPEAKER_REGEX.match(line)
        if spk_match:
            if expect_action or expect_line:
                all_errors.append(f"Line {line_num}: Previous dialogue sequence from line {last_speaker_line} was incomplete before new SPEAKER.")
            cid = spk_match.group(1)
            last_speaker_line = line_num
            expect_action = True
            expect_line = False
            continue

        if expect_action:
            if ACTION_REGEX.match(line):
                expect_action = False
                expect_line = True
                continue
            elif line:
                all_errors.append(f"Line {line_num}: Expected 'ACTION:' following SPEAKER from line {last_speaker_line}, got: '{line[:40]}'")
                expect_action = False

        if expect_line:
            if LINE_REGEX.match(line):
                expect_line = False
                continue
            elif line:
                all_errors.append(f"Line {line_num}: Expected 'LINE: \"...\"' following ACTION from line {last_speaker_line}, got: '{line[:40]}'")
                expect_line = False

    print(f"\n=== Tri-Lock Validation Report: {os.path.basename(filepath)} ===")
    print(f"Declared Characters: {len(declared_chars)} ({', '.join(sorted(declared_chars)) if declared_chars else 'None'})")
    print(f"Declared Environments: {len(declared_envs)} ({', '.join(sorted(declared_envs)) if declared_envs else 'None'})")
    print(f"Declared Styles: {len(declared_styles)} ({', '.join(sorted(declared_styles)) if declared_styles else 'None'})")
    
    if all_errors:
        print(f"\n❌ Found {len(all_errors)} validation issue(s):")
        for err in all_errors:
            print(f"  - {err}")
        return False
    else:
        print("\n✅ All Tri-Lock blocks and dialogue sequences validated successfully.")
        return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python tri_lock_validator.py <path_to_markdown_file>")
        sys.exit(1)
    success = validate_file(sys.argv[1])
    sys.exit(0 if success else 1)
