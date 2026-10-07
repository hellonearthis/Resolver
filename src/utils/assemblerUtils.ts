/**
 * src/utils/assemblerUtils.ts
 *
 * WHAT:
 *   Pure business logic, timeline math calculations, subtitle parsing, and payload formatters
 *   for the Music Video Assembler timeline, marker system, and DaVinci Resolve bridge.
 *
 * WHY:
 *   Extracting pure data transforms and math out of monolithic UI components makes them
 *   isolated, deterministic, easy for AI to digest and maintain, and 100% testable
 *   without complex DOM/WaveSurfer mocks.
 */

import type { ProjectMarker } from '../hooks/useProjectStorage';
import type { MusicSection } from '../types/sections';
import { SECTION_TYPE_COLOR_MAP } from '../types/sections';
import type { VideoClip, SelectionState, AudioMarker, StemData } from '../types/assembler';
import { MARKER_COLORS, getAlignedDuration } from './timelineUtils';

export interface ResolveExportMarker {
    time: number;
    timestamp: number;
    frame: number;
    type: string;
    color: string;
    note: string;
    duration_sec: number;
}

export interface MarkerLegendTooltipItem {
    label: string;
    count: number;
    color: string;
}

// WHAT: Set of known audio stem category identifiers resulting from audio source separation.
// WHY: Used to filter out stem-specific transients when querying the primary song timeline.
const STEM_CATEGORIES_LOOKUP_SET = new Set(['drums', 'bass', 'vocals', 'other', 'piano', 'guitar']);

// WHAT: Extracts main track beat markers from a project's comprehensive markers array.
// WHY: We filter out stem-specific markers (drums, bass, etc.) to give the main timeline
// only master rhythmic downbeats, offbeats, and acoustic transients, tagging downbeats distinctly.
export const extractMainMarkersFromProject = (project_markers_array?: ProjectMarker[]): AudioMarker[] => {
    // WHAT: Guard clause checking for undefined or empty markers array.
    // WHY: Returns an empty collection immediately to prevent null pointer exceptions.
    if (!project_markers_array || project_markers_array.length === 0) {
        return [];
    }

    return project_markers_array
        .filter(marker_candidate_item => {
            // WHAT: Keep markers that have no note or whose note is not a stem category.
            // WHY: Stem markers belong on individual stem waveforms, not the master track.
            return !marker_candidate_item.note || !STEM_CATEGORIES_LOOKUP_SET.has(marker_candidate_item.note.toLowerCase());
        })
        .map(filtered_marker_item => {
            // WHAT: Identifying whether this marker constitutes a primary musical downbeat (measure start).
            // WHY: Downbeats are visually highlighted with distinctive colors to guide video cuts.
            const is_downbeat_marker = filtered_marker_item.color === MARKER_COLORS.downbeat ||
                (Boolean(filtered_marker_item.note) && filtered_marker_item.note.toLowerCase().includes('downbeat'));

            return {
                time: filtered_marker_item.timestamp,
                type: filtered_marker_item.type,
                isDownbeat: is_downbeat_marker,
                color: filtered_marker_item.color || (is_downbeat_marker ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat)
            };
        });
};

// WHAT: Aggregates master track beat markers and all instrument stem markers into a unified payload for DaVinci Resolve.
// WHY: Resolve's scripting API needs frame numbers (time * fps), durations, colors, and notes formatted into
// timeline marker payloads so markers appear accurately in the NLE edit timeline.
export const buildResolveExportMarkers = (
    main_track_markers_collection: AudioMarker[],
    project_stems_collection: StemData[],
    timeline_frames_per_second: number = 24
): ResolveExportMarker[] => {
    const aggregated_export_markers_collection: ResolveExportMarker[] = [];

    // WHAT: Iterate through master track markers and format them for DaVinci Resolve.
    // WHY: Downbeats and offbeats guide the editor's primary cutting rhythm on Video Track 1.
    main_track_markers_collection.forEach(main_track_marker_item => {
        aggregated_export_markers_collection.push({
            time: main_track_marker_item.time,
            timestamp: main_track_marker_item.time,
            frame: Math.round(main_track_marker_item.time * timeline_frames_per_second),
            type: main_track_marker_item.type,
            color: main_track_marker_item.color || (main_track_marker_item.isDownbeat ? '#ff0000' : '#ffff00'),
            note: main_track_marker_item.isDownbeat ? 'DOWNBEAT' : 'BEAT',
            duration_sec: 0.05
        });
    });

    // WHAT: Iterate through each stem track and include its respective transients and beats.
    // WHY: Provides sub-track cues in Resolve (e.g., drum hits or vocal phrases) alongside master beats.
    project_stems_collection.forEach(stem_data_item => {
        if (stem_data_item.markers) {
            stem_data_item.markers.forEach(stem_marker_item => {
                aggregated_export_markers_collection.push({
                    time: stem_marker_item.time,
                    timestamp: stem_marker_item.time,
                    frame: Math.round(stem_marker_item.time * timeline_frames_per_second),
                    type: stem_marker_item.type,
                    color: stem_data_item.color || '#00ff00',
                    note: `${stem_data_item.type.toUpperCase()}: ${stem_marker_item.type}`,
                    duration_sec: 0.05
                });
            });
        }
    });

    return aggregated_export_markers_collection;
};

// WHAT: Formats musical song sections (intro, verse, chorus, bridge) into DaVinci Resolve chapter markers.
// WHY: Resolve chapter markers visualize high-level song architecture across the timeline header,
// giving color-coded section boundaries to help video directors align story acts with musical passages.
export const buildResolveSectionMarkers = (
    musical_sections_collection: MusicSection[],
    timeline_frames_per_second: number = 24
): ResolveExportMarker[] => {
    return musical_sections_collection.map(musical_section_item => {
        const section_color_metadata = SECTION_TYPE_COLOR_MAP[musical_section_item.type] || SECTION_TYPE_COLOR_MAP.verse;
        const section_duration_seconds = Math.max(1, musical_section_item.endTime - musical_section_item.startTime);

        return {
            time: musical_section_item.startTime,
            timestamp: musical_section_item.startTime,
            frame: Math.round(musical_section_item.startTime * timeline_frames_per_second),
            color: section_color_metadata.resolveColor,
            note: `${musical_section_item.name} (${musical_section_item.type.toUpperCase()})`,
            type: 'chapter',
            duration_sec: section_duration_seconds
        };
    });
};

export interface CreateClipOptions {
    selection_state?: SelectionState;
    selection?: SelectionState;
    project_stems_collection?: StemData[];
    stems?: StemData[];
    existing_clips_count?: number;
    existingClipsCount?: number;
    timeline_frames_per_second?: number;
    frameRate?: number;
}

// WHAT: Creates a new timeline VideoClip from a user's interactive region selection on a waveform.
// WHY: We snap the raw selection duration to valid MiniMax H3 frame counts (17n + 5) so that AI video
// generation never rejects the clip due to non-compliant frame durations.
export const createClipFromSelection = (options: CreateClipOptions): VideoClip => {
    const effective_selection = options.selection_state || options.selection;
    if (!effective_selection) {
        throw new Error('createClipFromSelection requires selection or selection_state');
    }
    const effective_stems = options.project_stems_collection || options.stems || [];
    const effective_clips_count = options.existing_clips_count ?? options.existingClipsCount ?? 0;
    const effective_frames_per_second = options.timeline_frames_per_second ?? options.frameRate ?? 20;

    const {
        start: selection_start_seconds,
        end: selection_end_seconds,
        source: selection_source,
        stemIndex: selection_stem_index
    } = effective_selection;

    // WHAT: Calculate the raw duration and quantize it upward to the nearest valid MiniMax frame boundary.
    // WHY: MiniMax generation strictly requires 17n + 5 frames. Generating unaligned lengths leads to audio drift.
    const raw_selection_duration_seconds = Math.max(0, selection_end_seconds - selection_start_seconds);
    const aligned_duration_seconds = getAlignedDuration(raw_selection_duration_seconds, effective_frames_per_second);
    const aligned_end_time_seconds = selection_start_seconds + aligned_duration_seconds;
    const alternating_track_index = (effective_clips_count % 2) + 1;

    return {
        id: Date.now().toString(),
        startTime: selection_start_seconds,
        endTime: aligned_end_time_seconds,
        duration: aligned_duration_seconds,
        track: alternating_track_index,
        status: 'pending',
        source: selection_source,
        stemName: selection_source === 'stem' && selection_stem_index !== undefined ? effective_stems[selection_stem_index]?.type : undefined,
        label: `clip_${effective_clips_count}`
    };
};

// WHAT: Shifts a clip's start time and adjusts its end time to strictly preserve duration.
// WHY: Used during timeline dragging, nudging, and repositioning so the clip duration remains invariant.
export const updateClipStartTime = (
    timeline_clips_collection: VideoClip[],
    target_clip_identifier: string,
    new_start_time_seconds: number
): VideoClip[] => {
    return timeline_clips_collection.map(current_clip_item => {
        if (current_clip_item.id === target_clip_identifier) {
            const preserved_duration_seconds = current_clip_item.duration || (current_clip_item.endTime - current_clip_item.startTime);
            return {
                ...current_clip_item,
                startTime: new_start_time_seconds,
                endTime: new_start_time_seconds + preserved_duration_seconds,
                duration: preserved_duration_seconds
            };
        }
        return current_clip_item;
    });
};

// WHAT: Resizes a clip's end time, quantizes duration to frame boundaries, and ripples all downstream clips.
// WHY: In a continuous music video edit, extending or shortening clip A must shift all subsequent clips forward or
// backward to maintain contiguous sequencing without gaps or overlapping collisions.
export const updateClipEndTimeWithRipple = (
    timeline_clips_collection: VideoClip[],
    target_clip_identifier: string,
    new_end_time_seconds: number,
    timeline_frames_per_second: number = 20
): VideoClip[] => {
    const sorted_clips_collection = [...timeline_clips_collection].sort(
        (first_clip, second_clip) => first_clip.startTime - second_clip.startTime
    );

    const target_clip_index = sorted_clips_collection.findIndex(
        clip_candidate => clip_candidate.id === target_clip_identifier
    );

    // WHAT: Guard clause if the target clip does not exist.
    // WHY: Prevents modifying the collection if an invalid clip identifier was supplied.
    if (target_clip_index === -1) {
        return timeline_clips_collection;
    }

    const current_target_clip = sorted_clips_collection[target_clip_index];

    // WHAT: Guard clause ensuring end time is strictly greater than start time.
    // WHY: Clips cannot have negative or zero duration on the timeline.
    if (new_end_time_seconds <= current_target_clip.startTime) {
        return timeline_clips_collection;
    }

    // WHAT: Calculate aligned duration and update the target clip.
    // WHY: Enforces valid MiniMax frame boundary calculations on the edited clip.
    const raw_duration_seconds = new_end_time_seconds - current_target_clip.startTime;
    const aligned_duration_seconds = getAlignedDuration(raw_duration_seconds, timeline_frames_per_second);

    sorted_clips_collection[target_clip_index] = {
        ...current_target_clip,
        endTime: current_target_clip.startTime + aligned_duration_seconds,
        duration: aligned_duration_seconds
    };

    // WHAT: Cascade / ripple downstream clips sequentially.
    // WHY: Shifts the start time of each subsequent clip to match the preceding clip's new end time.
    for (let cascade_index = target_clip_index + 1; cascade_index < sorted_clips_collection.length; cascade_index++) {
        const preceding_clip_item = sorted_clips_collection[cascade_index - 1];
        const preserved_clip_duration_seconds = sorted_clips_collection[cascade_index].duration ||
            (sorted_clips_collection[cascade_index].endTime - sorted_clips_collection[cascade_index].startTime);

        sorted_clips_collection[cascade_index] = {
            ...sorted_clips_collection[cascade_index],
            startTime: preceding_clip_item.endTime,
            endTime: preceding_clip_item.endTime + preserved_clip_duration_seconds,
            duration: preserved_clip_duration_seconds
        };
    }

    return sorted_clips_collection;
};

// WHAT: Parses standard SRT and WebVTT formatted subtitle text into structured timeline VideoClips.
// WHY: Automatically creates storyboard blocks from transcribed lyrics or dialogue without manual typing,
// placing consecutive subtitles onto alternating tracks (Track 1 and 2) to visualize checkerboarding.
export const parseSrtSubtitlesToClips = (
    raw_subtitles_text_content: string,
    initial_timeline_track: number = 1
): VideoClip[] => {
    // WHAT: Guard clause against empty subtitle file text.
    // WHY: Immediately returns an empty collection if the file content is empty or pure whitespace.
    if (!raw_subtitles_text_content || !raw_subtitles_text_content.trim()) {
        return [];
    }

    const raw_subtitle_lines_array = raw_subtitles_text_content.split(/\r?\n/);
    const imported_clips_collection: VideoClip[] = [];
    let current_timeline_track = initial_timeline_track;

    // WHAT: Regular expression matching standard SRT (00:01:23,456) and WebVTT (00:01:23.456) timestamp intervals.
    // WHY: Both formats express cue time ranges in hours:minutes:seconds with milliseconds separated by comma or period.
    const timecode_interval_regex = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

    for (let line_index = 0; line_index < raw_subtitle_lines_array.length; line_index++) {
        const regex_match_result = raw_subtitle_lines_array[line_index].match(timecode_interval_regex);

        if (regex_match_result) {
            let subtitle_text_accumulator = '';
            let subsequent_line_index = line_index + 1;

            // WHAT: Collect all lines of dialogue until the next timestamp interval or empty separator line.
            // WHY: Multi-line subtitles must be concatenated into a single cohesive dialogue string.
            while (
                subsequent_line_index < raw_subtitle_lines_array.length &&
                raw_subtitle_lines_array[subsequent_line_index].trim() !== '' &&
                !raw_subtitle_lines_array[subsequent_line_index].match(timecode_interval_regex)
            ) {
                // WHAT: Filter out numerical subtitle sequence index markers.
                // WHY: Numbers like "1", "2" on their own lines are SRT cue identifiers, not dialogue text.
                if (!/^\d+$/.test(raw_subtitle_lines_array[subsequent_line_index].trim())) {
                    subtitle_text_accumulator += raw_subtitle_lines_array[subsequent_line_index].trim() + ' ';
                }
                subsequent_line_index++;
            }
            subtitle_text_accumulator = subtitle_text_accumulator.trim();

            if (subtitle_text_accumulator) {
                const start_hours_value = parseInt(regex_match_result[1], 10);
                const start_minutes_value = parseInt(regex_match_result[2], 10);
                const start_seconds_value = parseInt(regex_match_result[3], 10);
                const start_milliseconds_value = parseInt(regex_match_result[4], 10);

                const end_hours_value = parseInt(regex_match_result[5], 10);
                const end_minutes_value = parseInt(regex_match_result[6], 10);
                const end_seconds_value = parseInt(regex_match_result[7], 10);
                const end_milliseconds_value = parseInt(regex_match_result[8], 10);

                const parsed_start_time_seconds = start_hours_value * 3600 + start_minutes_value * 60 + start_seconds_value + start_milliseconds_value / 1000;
                const parsed_end_time_seconds = end_hours_value * 3600 + end_minutes_value * 60 + end_seconds_value + end_milliseconds_value / 1000;

                let calculated_clip_duration_seconds = parsed_end_time_seconds - parsed_start_time_seconds;
                if (calculated_clip_duration_seconds <= 0) {
                    calculated_clip_duration_seconds = 1;
                }

                const truncated_label_text = subtitle_text_accumulator.substring(0, 30) + (subtitle_text_accumulator.length > 30 ? '...' : '');

                const new_subtitle_clip_item: VideoClip = {
                    id: `subtitle-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    startTime: parsed_start_time_seconds,
                    duration: calculated_clip_duration_seconds,
                    endTime: parsed_end_time_seconds,
                    track: current_timeline_track,
                    status: 'pending',
                    source: 'main',
                    label: truncated_label_text || 'Subtitle',
                    notes: {
                        action: subtitle_text_accumulator,
                        dialogue: '',
                        sound: ''
                    }
                };

                imported_clips_collection.push(new_subtitle_clip_item);
                // WHAT: Alternate between Track 1 and Track 2.
                // WHY: Checkerboard track placement makes adjacent subtitle boundaries visually legible.
                current_timeline_track = current_timeline_track === 1 ? 2 : 1;
            }
        }
    }

    return imported_clips_collection;
};

// WHAT: Aggregates marker counts for the master track and each individual stem based on a filter predicate.
// WHY: Used to populate the tooltip breakdown on the beat key legend (e.g., showing how many downbeats are in drums vs vocals).
export const calculateMarkerLegendCounts = (
    main_track_markers_collection: AudioMarker[],
    project_stems_collection: StemData[],
    filter_predicate_function: (marker_item: AudioMarker) => boolean
): MarkerLegendTooltipItem[] => {
    const marker_legend_summary_collection: MarkerLegendTooltipItem[] = [
        { label: 'Main Track', count: main_track_markers_collection.filter(filter_predicate_function).length, color: '#fff' }
    ];

    project_stems_collection.forEach(stem_data_item => {
        marker_legend_summary_collection.push({
            label: stem_data_item.type,
            count: (stem_data_item.markers || []).filter(filter_predicate_function).length,
            color: stem_data_item.color || '#fff'
        });
    });

    return marker_legend_summary_collection;
};
