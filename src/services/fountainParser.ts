/**
 * src/services/fountainParser.ts
 * 
 * WHAT:
 *   Clean-room parser for the Fountain 1.1 screenwriting specification tailored for
 *   musical storyboards, video assembly, and DaVinci Resolve timelines.
 * 
 * WHY:
 *   Converts plain text screenplay files into structured Resolver MusicSection[] and
 *   VideoClip[] storyboard cards. Ensures:
 *   - Sections (#) become song sections (verse, chorus, bridge) with assigned colors.
 *   - Synopses (=) become the short card prompt (clip.notes.action) for AI cinematic expansion.
 *   - Notes ([[ ]]) become director or camera directives stored in scriptNotes, strictly
 *     kept out of the generative prompt to prevent prompt contamination.
 *   - Locked scene numbers (#1#, #1A#) provide stable card IDs that survive reordering.
 *   - Boneyards (/* *\/) are parsed as muted cards (isMuted: true) skipped by assemblers.
 */

import type { VideoClip } from '../types/assembler';
import { type MusicSection, type SectionType, SECTION_TYPE_COLOR_MAP } from '../types/sections';
import { PacingBenchmarks } from '../types/storyboard';
import { getAlignedDuration } from '../utils/timelineUtils';

export interface FountainParserOptions {
    frameRate?: number;
    defaultShotDurationSeconds?: number;
    wpm?: number;
    existingClips?: VideoClip[];
}

export interface ParsedFountainScene {
    id: string;
    sceneNumber: string;
    shotLetter: string;
    heading: string;
    location: string;
    locationType: 'INT' | 'EXT';
    synopsis: string;
    scriptNotes: string[];
    character?: string;
    parenthetical?: string;
    dialogue: string;
    sectionName: string;
    sectionType: SectionType;
    isBoneyard: boolean;
}

export interface ParsedFountainResult {
    title: string;
    author: string;
    sections: MusicSection[];
    clips: VideoClip[];
}

/**
 * Normalizes an arbitrary section title into a canonical SectionType enum.
 */
export function normalizeSectionType(raw_section_name: string): SectionType {
    const cleaned_name = raw_section_name.toLowerCase().trim();
    if (cleaned_name.includes('pre-chorus') || cleaned_name.includes('prechorus') || cleaned_name.includes('pre chorus')) {
        return 'pre-chorus';
    }
    if (cleaned_name.includes('chorus') || cleaned_name.includes('hook') || cleaned_name.includes('refrain')) {
        return 'chorus';
    }
    if (cleaned_name.includes('bridge') || cleaned_name.includes('middle 8')) {
        return 'bridge';
    }
    if (cleaned_name.includes('intro')) {
        return 'intro';
    }
    if (cleaned_name.includes('outro') || cleaned_name.includes('coda') || cleaned_name.includes('ending')) {
        return 'outro';
    }
    if (cleaned_name.includes('breakdown') || cleaned_name.includes('drop')) {
        return 'breakdown';
    }
    if (cleaned_name.includes('solo')) {
        return 'solo';
    }
    return 'verse';
}

/**
 * Parses raw Fountain text into sections and storyboard video cards.
 */
export function parseFountainScript(
    raw_fountain_text: string,
    options: FountainParserOptions = {}
): ParsedFountainResult {
    const frame_rate = options.frameRate || 24;
    const default_duration = options.defaultShotDurationSeconds || 4.0;
    const pace_wpm = options.wpm || PacingBenchmarks.CONVERSATIONAL;

    // Normalize newlines
    const normalized_text = (raw_fountain_text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const raw_lines = normalized_text.split('\n');

    let script_title = 'Untitled Storyboard';
    let script_author = 'Director';

    let current_section_name = 'Main';
    let current_section_type: SectionType = 'verse';
    let current_section_depth = 1;

    interface RawSectionBlock {
        id: string;
        name: string;
        type: SectionType;
        depth: number;
        scenes: ParsedFountainScene[];
    }

    const section_blocks: RawSectionBlock[] = [];
    let active_section_block: RawSectionBlock = {
        id: `sec-${Date.now()}-0`,
        name: current_section_name,
        type: current_section_type,
        depth: current_section_depth,
        scenes: []
    };

    let active_scene: ParsedFountainScene | null = null;
    let in_boneyard = false;
    let in_title_page = true;
    let scene_counter = 0;

    const commitActiveScene = () => {
        if (!active_scene) return;
        active_section_block.scenes.push(active_scene);
        active_scene = null;
    };

    const commitActiveSection = () => {
        commitActiveScene();
        if (active_section_block.scenes.length > 0) {
            section_blocks.push(active_section_block);
        }
    };

    for (let line_index = 0; line_index < raw_lines.length; line_index++) {
        let line = raw_lines[line_index];
        let trimmed_line = line.trim();

        // Check for boneyard start / end /* ... */
        if (trimmed_line.startsWith('/*')) {
            commitActiveScene();
            in_boneyard = true;
            if (trimmed_line.endsWith('*/') && trimmed_line.length > 2) {
                in_boneyard = false;
                continue;
            }
            continue;
        }
        if (in_boneyard) {
            if (trimmed_line.endsWith('*/')) {
                commitActiveScene();
                in_boneyard = false;
                continue;
            }
        }

        // Title page parsing (key: value at the start of document)
        if (in_title_page) {
            if (trimmed_line === '') {
                // An empty line marks the end of title page key-values if any were found
                if (script_title !== 'Untitled Storyboard' || script_author !== 'Director') {
                    in_title_page = false;
                    continue;
                }
            } else if (trimmed_line.includes(':')) {
                const colon_split_index = trimmed_line.indexOf(':');
                const title_key = trimmed_line.slice(0, colon_split_index).trim().toLowerCase();
                const title_val = trimmed_line.slice(colon_split_index + 1).trim();
                if (title_key === 'title') {
                    script_title = title_val;
                    continue;
                }
                if (title_key === 'author' || title_key === 'authors') {
                    script_author = title_val;
                    continue;
                }
            } else {
                in_title_page = false;
            }
        }

        // 1. Sections (# Section Header)
        if (trimmed_line.startsWith('#')) {
            const hash_match = trimmed_line.match(/^(#+)\s*(.*)$/);
            if (hash_match) {
                commitActiveSection();
                const hash_count = hash_match[1].length;
                const section_title = hash_match[2].trim() || `Section ${section_blocks.length + 1}`;
                current_section_name = section_title;
                current_section_type = normalizeSectionType(section_title);
                current_section_depth = hash_count;

                active_section_block = {
                    id: `sec-${Date.now()}-${section_blocks.length + 1}`,
                    name: current_section_name,
                    type: current_section_type,
                    depth: current_section_depth,
                    scenes: []
                };
                continue;
            }
        }

        // 2. Scene Headings (INT., EXT., INT/EXT., I/E., or leading dot .)
        const is_scene_heading = 
            trimmed_line.startsWith('.') ||
            /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(trimmed_line);

        // If inside a boneyard without an active scene or scene heading, it's just raw commentary
        if (in_boneyard && !active_scene && !is_scene_heading) {
            continue;
        }

        if (is_scene_heading) {
            commitActiveScene();
            scene_counter++;

            let heading_text = trimmed_line;
            if (heading_text.startsWith('.')) {
                heading_text = heading_text.slice(1).trim();
            }

            // Extract scene number e.g. #1#, #1A#, #SCN-04#
            let scene_number = `${scene_counter}`;
            let stable_id = `scn-${scene_counter}`;
            const scene_number_match = heading_text.match(/#([A-Za-z0-9_-]+)#\s*$/);
            if (scene_number_match) {
                scene_number = scene_number_match[1];
                stable_id = `card-fountain-${scene_number}`;
                heading_text = heading_text.replace(/#([A-Za-z0-9_-]+)#\s*$/, '').trim();
            } else {
                stable_id = `card-fountain-${scene_counter}`;
            }

            const location_type: 'INT' | 'EXT' = heading_text.toUpperCase().includes('INT') ? 'INT' : 'EXT';

            active_scene = {
                id: stable_id,
                sceneNumber: scene_number,
                shotLetter: 'A',
                heading: heading_text,
                location: heading_text,
                locationType: location_type,
                synopsis: '',
                scriptNotes: [],
                dialogue: '',
                sectionName: current_section_name,
                sectionType: current_section_type,
                isBoneyard: in_boneyard
            };
            continue;
        }

        // 3. Synopses (= Synopsis line)
        if (trimmed_line.startsWith('=')) {
            const synopsis_content = trimmed_line.replace(/^=\s*/, '').trim();
            if (active_scene) {
                if (active_scene.synopsis) {
                    active_scene.synopsis += ' ' + synopsis_content;
                } else {
                    active_scene.synopsis = synopsis_content;
                }
            }
            continue;
        }

        // 4. Notes ([[ Note content ]])
        if (trimmed_line.includes('[[')) {
            const note_matches = trimmed_line.match(/\[\[(.*?)\]\]/g);
            if (note_matches) {
                for (const match_str of note_matches) {
                    const clean_note = match_str.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
                    if (clean_note && active_scene) {
                        active_scene.scriptNotes.push(clean_note);
                    }
                }
                // Strip notes from line to check if remaining line has text
                const stripped_line = trimmed_line.replace(/\[\[(.*?)\]\]/g, '').replace(/\s{2,}/g, ' ').trim();
                if (!stripped_line) {
                    continue;
                }
                line = stripped_line;
                trimmed_line = stripped_line;
            }
        }

        // 5. Parenthetical e.g. (singing) or (whispering)
        if (trimmed_line.startsWith('(') && trimmed_line.endsWith(')')) {
            if (active_scene) {
                active_scene.parenthetical = trimmed_line.slice(1, -1).trim();
            }
            continue;
        }

        // 6. Character Cue (Uppercase name or forced @cue)
        const is_character_cue = 
            trimmed_line.startsWith('@') ||
            (trimmed_line.length > 0 &&
            trimmed_line.length < 35 &&
            trimmed_line === trimmed_line.toUpperCase() &&
            !trimmed_line.includes('.') &&
            !trimmed_line.startsWith('=') &&
            !trimmed_line.startsWith('#'));

        if (is_character_cue) {
            if (active_scene) {
                active_scene.character = trimmed_line.replace(/^@/, '').trim();
            }
            continue;
        }

        // 7. Dialogue / Song lyrics / Action prose
        if (trimmed_line.length > 0) {
            if (active_scene) {
                if (active_scene.character) {
                    // Character has been declared, this is lyrics or dialogue
                    active_scene.dialogue = active_scene.dialogue 
                        ? `${active_scene.dialogue}\n${trimmed_line}`
                        : trimmed_line;
                } else if (!active_scene.synopsis) {
                    // If no synopsis was explicitly given with =, default prose acts as synopsis
                    active_scene.synopsis = trimmed_line;
                }
            }
        }
    }

    commitActiveSection();

    // Now assemble MusicSection[] and VideoClip[] with timeline synchronization
    const result_sections: MusicSection[] = [];
    const result_clips: VideoClip[] = [];

    let current_timeline_cursor = 0.0;

    for (let sec_idx = 0; sec_idx < section_blocks.length; sec_idx++) {
        const sec_block = section_blocks[sec_idx];
        const section_start_time = current_timeline_cursor;
        const section_color = SECTION_TYPE_COLOR_MAP[sec_block.type]?.border || '#6366f1';

        let last_active_shot_start_time = current_timeline_cursor;

        for (let scn_idx = 0; scn_idx < sec_block.scenes.length; scn_idx++) {
            const scn = sec_block.scenes[scn_idx];
            
            // Calculate shot duration: dialogue word count pacing or default duration
            let calculated_duration = default_duration;
            if (scn.dialogue) {
                const words = scn.dialogue.trim().split(/\s+/).filter(w => w.length > 0);
                if (words.length > 0) {
                    const raw_seconds = (words.length / pace_wpm) * 60;
                    calculated_duration = Math.max(2.0, raw_seconds);
                }
            }
            const aligned_duration = getAlignedDuration(calculated_duration, frame_rate);
            
            let shot_start_time: number;
            let shot_end_time: number;

            if (scn.isBoneyard) {
                // An alternate take in boneyard aligns with the last active shot in this section
                // and does NOT advance the primary timeline cursor.
                shot_start_time = last_active_shot_start_time;
                shot_end_time = shot_start_time + aligned_duration;
            } else {
                shot_start_time = current_timeline_cursor;
                shot_end_time = shot_start_time + aligned_duration;
                last_active_shot_start_time = shot_start_time;
                current_timeline_cursor = shot_end_time;
            }

            // Extract camera/optics hints from scriptNotes if present
            let parsed_optics: string | undefined;
            let parsed_movement: string | undefined;
            let parsed_vfx: string | undefined;

            for (const note of scn.scriptNotes) {
                const lower = note.toLowerCase();
                if (lower.includes('lens') || lower.includes('optics') || lower.includes('35mm') || lower.includes('50mm') || lower.includes('anamorphic') || lower.includes('angle')) {
                    parsed_optics = note;
                } else if (lower.includes('dolly') || lower.includes('pan') || lower.includes('push') || lower.includes('tilt') || lower.includes('handheld') || lower.includes('steadicam')) {
                    parsed_movement = note;
                } else if (lower.includes('vfx') || lower.includes('lighting') || lower.includes('shutter') || lower.includes('strobe')) {
                    parsed_vfx = note;
                }
            }

            // Match with existing clips to preserve stable IDs and generated media assets across re-imports
            let matched_existing_clip: VideoClip | undefined;
            if (options.existingClips && options.existingClips.length > 0) {
                matched_existing_clip = options.existingClips.find(candidate => 
                    candidate.id === scn.id ||
                    (candidate.sceneNumber && candidate.sceneNumber === scn.sceneNumber) ||
                    (candidate.label && candidate.label === `Shot ${scn.sceneNumber}`)
                );
            }

            const final_clip_id = matched_existing_clip ? matched_existing_clip.id : scn.id;
            const clip: VideoClip = {
                ...(matched_existing_clip || {}),
                id: final_clip_id,
                startTime: shot_start_time,
                duration: aligned_duration,
                endTime: shot_end_time,
                track: (result_clips.length % 2 === 0) ? 1 : 2,
                status: matched_existing_clip?.status || 'pending',
                source: matched_existing_clip?.source || 'main',
                videoPath: matched_existing_clip?.videoPath,
                generatedVideos: matched_existing_clip?.generatedVideos,
                startImagePath: matched_existing_clip?.startImagePath,
                endImagePath: matched_existing_clip?.endImagePath,
                startImageFunction: matched_existing_clip?.startImageFunction,
                endImageFunction: matched_existing_clip?.endImageFunction,
                aiExpandedPrompt: matched_existing_clip?.aiExpandedPrompt,
                expandedPromptLocked: matched_existing_clip?.expandedPromptLocked,
                label: `Shot ${scn.sceneNumber}`,
                sceneNumber: scn.sceneNumber,
                shotLetter: scn.shotLetter,
                notes: {
                    action: scn.synopsis,
                    dialogue: scn.dialogue,
                    sound: scn.parenthetical ? `Delivery: ${scn.parenthetical}` : (matched_existing_clip?.notes?.sound || '')
                },
                locationType: scn.locationType,
                optics: parsed_optics || matched_existing_clip?.optics,
                cameraMovement: parsed_movement || matched_existing_clip?.cameraMovement,
                vfxNotes: parsed_vfx || matched_existing_clip?.vfxNotes,
                paceWpm: pace_wpm,
                sectionId: sec_block.id,
                sectionName: sec_block.name,
                sectionType: sec_block.type,
                scriptNotes: scn.scriptNotes,
                isMuted: scn.isBoneyard ? true : (matched_existing_clip?.isMuted ?? false)
            };

            result_clips.push(clip);
        }

        const section_end_time = Math.max(section_start_time + 1.0, current_timeline_cursor);
        result_sections.push({
            id: sec_block.id,
            name: sec_block.name,
            type: sec_block.type,
            startTime: section_start_time,
            endTime: section_end_time,
            color: section_color
        });
    }

    return {
        title: script_title,
        author: script_author,
        sections: result_sections,
        clips: result_clips
    };
}
