/**
 * src/services/revisionDiffService.ts
 * 
 * WHAT:
 *   Revision diff engine comparing current storyboard card prompts and metadata
 *   against rendered baselines, producing DaVinci Resolve marker color updates
 *   and filtering the ComfyUI generation queue.
 * 
 * WHY:
 *   Prevents wasting hundreds of GPU seconds by regenerating clips whose prompts
 *   have not changed, and visibly displays in Resolve which shots were modified,
 *   newly added, or remain untouched.
 */

import type { VideoClip } from '../types/assembler';

export type RevisionState = 'new' | 'changed' | 'unchanged';

/**
 * DaVinci Resolve canonical marker colors representing revision states.
 */
export const REVISION_RESOLVE_COLOR_MAP: Record<RevisionState, string> = {
    new: 'Cyan',
    changed: 'Yellow',
    unchanged: 'Green'
};

export interface CardRevisionDiff {
    clipId: string;
    sceneNumber: string;
    label: string;
    state: RevisionState;
    resolveColor: string;
    currentFingerprint: string;
    baselineFingerprint?: string;
    hasGeneratedVideo: boolean;
}

export interface ResolveRevisionMarker {
    frame: number;
    color: string;
    name: string; // Persistent Card ID
    note: string;
    duration_frames: number;
    state: RevisionState;
}

/**
 * Computes a deterministic generative fingerprint for a card based on its prompt,
 * dialogue, reference image paths, camera optics, and duration.
 */
export function computeCardGenerativeFingerprint(clip: VideoClip): string {
    const prompt_seed = (clip.aiExpandedPrompt || clip.notes?.action || '').trim();
    const dialogue_text = (clip.notes?.dialogue || '').trim();
    const start_img = clip.startImagePath || '';
    const end_img = clip.endImagePath || '';
    const optics_spec = clip.optics || '';
    const movement_spec = clip.cameraMovement || '';
    const vfx_spec = clip.vfxNotes || '';
    const shot_duration = Math.round((clip.duration || 4.0) * 100) / 100;

    const raw_signature = [
        `prompt:${prompt_seed}`,
        `dialogue:${dialogue_text}`,
        `start:${start_img}`,
        `end:${end_img}`,
        `optics:${optics_spec}`,
        `movement:${movement_spec}`,
        `vfx:${vfx_spec}`,
        `duration:${shot_duration}`
    ].join('|');

    // Simple deterministic hash function for string signature
    let hash_value = 0;
    for (let char_idx = 0; char_idx < raw_signature.length; char_idx++) {
        const char_code = raw_signature.charCodeAt(char_idx);
        hash_value = ((hash_value << 5) - hash_value) + char_code;
        hash_value |= 0;
    }

    return `fp-${Math.abs(hash_value).toString(16)}`;
}

/**
 * Evaluates the revision state of an individual clip.
 */
export function evaluateClipRevision(
    clip: VideoClip,
    baselineFingerprint?: string
): RevisionState {
    const current_fp = computeCardGenerativeFingerprint(clip);
    const comparison_baseline = baselineFingerprint || clip.lastRenderedFingerprint;

    // If it has never been rendered and has no baseline, it is new
    if (!clip.videoPath && !comparison_baseline) {
        return 'new';
    }

    // If a baseline exists, compare directly
    if (comparison_baseline) {
        return current_fp === comparison_baseline ? 'unchanged' : 'changed';
    }

    // If it has a video file on disk but no stored fingerprint baseline, assume unchanged
    if (clip.videoPath) {
        return 'unchanged';
    }

    return 'new';
}

/**
 * Evaluates the revision state for a collection of clips compared to baseline snapshots.
 */
export function evaluateProjectRevisions(
    clips: VideoClip[],
    baselineSnapshots?: Record<string, string> // clipId -> baselineFingerprint
): Map<string, CardRevisionDiff> {
    const diff_map = new Map<string, CardRevisionDiff>();

    for (const clip of clips) {
        const baseline_fp = baselineSnapshots ? baselineSnapshots[clip.id] : clip.lastRenderedFingerprint;
        const current_fp = computeCardGenerativeFingerprint(clip);
        const state = evaluateClipRevision(clip, baseline_fp);
        const color = REVISION_RESOLVE_COLOR_MAP[state];

        diff_map.set(clip.id, {
            clipId: clip.id,
            sceneNumber: clip.sceneNumber || '1',
            label: clip.label || `Shot ${clip.sceneNumber || '1'}`,
            state,
            resolveColor: color,
            currentFingerprint: current_fp,
            baselineFingerprint: baseline_fp,
            hasGeneratedVideo: Boolean(clip.videoPath)
        });
    }

    return diff_map;
}

/**
 * Builds timeline marker descriptors for DaVinci Resolve with revision colors and card IDs.
 */
export function buildResolveRevisionMarkers(
    clips: VideoClip[],
    revisions: Map<string, CardRevisionDiff>,
    frameRate: number = 24
): ResolveRevisionMarker[] {
    const markers: ResolveRevisionMarker[] = [];

    for (const clip of clips) {
        const rev = revisions.get(clip.id);
        const state: RevisionState = rev ? rev.state : (clip.videoPath ? 'unchanged' : 'new');
        const color = REVISION_RESOLVE_COLOR_MAP[state];
        const record_frame = Math.round(clip.startTime * frameRate);
        const duration_frames = Math.max(1, Math.round((clip.endTime - clip.startTime) * frameRate));
        
        const note_text = `[${state.toUpperCase()}] ${clip.label}: ${(clip.notes?.action || '').slice(0, 100)}`;

        markers.push({
            frame: record_frame,
            color,
            name: clip.id, // Persistent card ID in marker title
            note: note_text,
            duration_frames,
            state
        });
    }

    return markers;
}

/**
 * Filters a list of clips for ComfyUI generation, skipping unchanged clips.
 */
export function filterClipsForGeneration(
    clips: VideoClip[],
    revisions: Map<string, CardRevisionDiff>
): {
    clipsToGenerate: VideoClip[];
    skippedClips: VideoClip[];
} {
    const clipsToGenerate: VideoClip[] = [];
    const skippedClips: VideoClip[] = [];

    for (const clip of clips) {
        const rev = revisions.get(clip.id);
        const state: RevisionState = rev ? rev.state : (clip.videoPath ? 'unchanged' : 'new');

        // Skip unchanged clips and muted/boneyard alternate clips
        if ((state === 'unchanged' && clip.videoPath) || clip.isMuted) {
            skippedClips.push(clip);
        } else {
            clipsToGenerate.push(clip);
        }
    }

    return { clipsToGenerate, skippedClips };
}
