/**
 * src/services/manifestService.ts
 * 
 * WHAT:
 *   Generates and validates canonical `music_video_manifest.json` payloads for
 *   DaVinci Resolve automation and timeline assembly.
 * 
 * WHY:
 *   Binds persistent card IDs (e.g. `card-fountain-1`, `card-fountain-2`) to media files,
 *   timecode intervals, and track assignments. Ensures that if cards are reordered,
 *   the same ID always points to the same underlying narrative shot and media in Resolve.
 */

import type { BeatProject } from '../hooks/useProjectStorage';
import type { VideoClip } from '../types/assembler';

export interface ManifestClipEntry {
    id: string;
    scene_number: string;
    shot_letter: string;
    label: string;
    display_name: string;
    path: string;
    start_seconds: number;
    end_seconds: number;
    duration: number;
    track: number;
    section_name?: string;
    section_type?: string;
    action_directive?: string;
    dialogue?: string;
    is_muted?: boolean;
}

export interface MusicVideoManifest {
    project_id: string;
    project_name: string;
    project_fps: number;
    audio_path?: string;
    export_timestamp: string;
    total_duration_seconds: number;
    clips: ManifestClipEntry[];
}

/**
 * Builds a manifest object from a BeatProject and its clips.
 * By default, muted boneyard alternate takes are excluded from the assembly manifest
 * unless includeMuted is explicitly requested.
 */
export function generateMusicVideoManifest(
    project: BeatProject,
    customClipsList?: VideoClip[],
    options?: { includeMuted?: boolean }
): MusicVideoManifest {
    const raw_clips = customClipsList || project.clips || [];
    const source_clips = options?.includeMuted 
        ? raw_clips 
        : raw_clips.filter(clip => !clip.isMuted);
    
    // Sort clips chronologically by start time
    const chronological_clips = [...source_clips].sort((first_clip, second_clip) => 
        first_clip.startTime - second_clip.startTime
    );

    const manifest_clips: ManifestClipEntry[] = chronological_clips.map((clip, index) => {
        const scene_num = clip.sceneNumber || `${index + 1}`;
        const shot_let = clip.shotLetter || 'A';
        const label_text = clip.label || `Shot ${scene_num}`;
        const clip_id = clip.id || `card-fountain-${scene_num}`;
        const display_name = `[${clip_id}] ${label_text}`;

        return {
            id: clip_id,
            scene_number: scene_num,
            shot_letter: shot_let,
            label: label_text,
            display_name: display_name,
            path: clip.videoPath || '',
            start_seconds: Number(clip.startTime.toFixed(3)),
            end_seconds: Number(clip.endTime.toFixed(3)),
            duration: Number(clip.duration.toFixed(3)),
            track: clip.track || ((index % 2 === 0) ? 1 : 2),
            section_name: clip.sectionName,
            section_type: clip.sectionType,
            action_directive: clip.notes?.action || '',
            dialogue: clip.notes?.dialogue || '',
            is_muted: clip.isMuted
        };
    });

    const total_duration = manifest_clips.length > 0 
        ? manifest_clips[manifest_clips.length - 1].end_seconds 
        : (project.duration || 0);

    return {
        project_id: project.id,
        project_name: project.name || 'Untitled Project',
        project_fps: project.frameRate || 24,
        audio_path: project.audioPath || '',
        export_timestamp: new Date().toISOString(),
        total_duration_seconds: Number(total_duration.toFixed(3)),
        clips: manifest_clips
    };
}
