/**
 * src/services/revisionDiffService.test.ts
 * 
 * Unit tests for Phase 3:
 * - Deterministic card generative fingerprinting
 * - Revision diff states (new, changed, unchanged)
 * - Timeline marker generation with DaVinci Resolve color mapping
 * - Filtering ComfyUI queue to skip unchanged cards
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseFountainScript } from './fountainParser';
import {
    computeCardGenerativeFingerprint,
    evaluateClipRevision,
    evaluateProjectRevisions,
    buildResolveRevisionMarkers,
    filterClipsForGeneration,
    REVISION_RESOLVE_COLOR_MAP
} from './revisionDiffService';
import type { VideoClip } from '../types/assembler';

describe('Phase 3: Revision Diff Service & Resolve Marker Sync', () => {
    it('computes stable deterministic fingerprints that respond to generative changes', () => {
        const baseClip: VideoClip = {
            id: 'card-1',
            startTime: 0,
            duration: 4.0,
            endTime: 4.0,
            track: 1,
            status: 'pending',
            source: 'main',
            label: 'Shot 1',
            notes: { action: 'Neon skyline with pouring rain.', dialogue: '', sound: '' },
            optics: '35mm anamorphic',
            cameraMovement: 'slow push in',
            startImagePath: 'C:\\images\\start.png'
        };

        const fp1 = computeCardGenerativeFingerprint(baseClip);
        const fp2 = computeCardGenerativeFingerprint({ ...baseClip });
        expect(fp1).toBe(fp2);
        expect(fp1.startsWith('fp-')).toBe(true);

        // Modifying action prompt changes the fingerprint
        const modifiedActionClip: VideoClip = {
            ...baseClip,
            notes: { ...baseClip.notes!, action: 'Neon skyline with fireworks.' }
        };
        expect(computeCardGenerativeFingerprint(modifiedActionClip)).not.toBe(fp1);

        // Modifying duration changes the fingerprint
        const modifiedDurationClip: VideoClip = {
            ...baseClip,
            duration: 5.5,
            endTime: 5.5
        };
        expect(computeCardGenerativeFingerprint(modifiedDurationClip)).not.toBe(fp1);

        // Modifying optics changes the fingerprint
        const modifiedOpticsClip: VideoClip = {
            ...baseClip,
            optics: '85mm portrait telephoto'
        };
        expect(computeCardGenerativeFingerprint(modifiedOpticsClip)).not.toBe(fp1);

        // Modifying startImagePath changes the fingerprint
        const modifiedImageClip: VideoClip = {
            ...baseClip,
            startImagePath: 'C:\\images\\different_start.png'
        };
        expect(computeCardGenerativeFingerprint(modifiedImageClip)).not.toBe(fp1);
    });

    it('evaluates revision states correctly for individual clips', () => {
        const unrenderedClip: VideoClip = {
            id: 'card-new',
            startTime: 0,
            duration: 4.0,
            endTime: 4.0,
            track: 1,
            status: 'pending',
            source: 'main',
            label: 'New Shot',
            notes: { action: 'Brand new scene beat', dialogue: '', sound: '' }
        };

        // No video and no baseline = 'new'
        expect(evaluateClipRevision(unrenderedClip)).toBe('new');

        // Rendered clip with matching fingerprint = 'unchanged'
        const fp = computeCardGenerativeFingerprint(unrenderedClip);
        const renderedClip: VideoClip = {
            ...unrenderedClip,
            videoPath: 'C:\\Resolver\\output\\shot_take1.mp4',
            lastRenderedFingerprint: fp,
            status: 'done'
        };
        expect(evaluateClipRevision(renderedClip)).toBe('unchanged');

        // Edited prompt with old baseline = 'changed'
        const editedClip: VideoClip = {
            ...renderedClip,
            notes: { ...renderedClip.notes!, action: 'Modified scene beat with lightning' }
        };
        expect(evaluateClipRevision(editedClip)).toBe('changed');

        // Rendered clip with videoPath but missing stored fingerprint defaults to 'unchanged'
        const legacyRenderedClip: VideoClip = {
            ...unrenderedClip,
            videoPath: 'C:\\Resolver\\output\\legacy.mp4'
        };
        expect(evaluateClipRevision(legacyRenderedClip)).toBe('unchanged');
    });

    it('correctly detects diff between 01_sections_synopses baseline and 03_revision_diff fixture', () => {
        // Step 1: Parse initial baseline fixture (Scenes 1, 2, 3)
        const baselinePath = path.resolve(process.cwd(), 'fixtures/fountain/01_sections_synopses.fountain');
        const baselineText = fs.readFileSync(baselinePath, 'utf8');
        const baselineResult = parseFountainScript(baselineText, { frameRate: 24 });
        expect(baselineResult.clips.length).toBe(3);

        // Simulate that all 3 shots were previously rendered
        const renderedClips: VideoClip[] = baselineResult.clips.map(clip => ({
            ...clip,
            videoPath: `C:\\Resolver\\output\\${clip.id}.mp4`,
            status: 'done',
            lastRenderedFingerprint: computeCardGenerativeFingerprint(clip)
        }));

        // Step 2: Parse revision 2 script (03_revision_diff.fountain)
        // Scene 1 & 3 are unchanged, Scene 2 prompt was edited, Scene 4 was added!
        const diffPath = path.resolve(process.cwd(), 'fixtures/fountain/03_revision_diff.fountain');
        const diffText = fs.readFileSync(diffPath, 'utf8');
        const diffResult = parseFountainScript(diffText, {
            frameRate: 24,
            existingClips: renderedClips
        });

        expect(diffResult.clips.length).toBe(4);

        // Step 3: Evaluate project revisions
        const revisionMap = evaluateProjectRevisions(diffResult.clips);

        // Scene 1: Unchanged -> Green
        const rev1 = revisionMap.get('card-fountain-1');
        expect(rev1).toBeDefined();
        expect(rev1?.state).toBe('unchanged');
        expect(rev1?.resolveColor).toBe('Green');
        expect(rev1?.hasGeneratedVideo).toBe(true);

        // Scene 2: Changed -> Yellow
        const rev2 = revisionMap.get('card-fountain-2');
        expect(rev2).toBeDefined();
        expect(rev2?.state).toBe('changed');
        expect(rev2?.resolveColor).toBe('Yellow');
        expect(rev2?.hasGeneratedVideo).toBe(true);
        expect(rev2?.currentFingerprint).not.toBe(rev2?.baselineFingerprint);

        // Scene 3: Unchanged -> Green
        const rev3 = revisionMap.get('card-fountain-3');
        expect(rev3).toBeDefined();
        expect(rev3?.state).toBe('unchanged');
        expect(rev3?.resolveColor).toBe('Green');
        expect(rev3?.hasGeneratedVideo).toBe(true);

        // Scene 4: New -> Cyan
        const rev4 = revisionMap.get('card-fountain-4');
        expect(rev4).toBeDefined();
        expect(rev4?.state).toBe('new');
        expect(rev4?.resolveColor).toBe('Cyan');
        expect(rev4?.hasGeneratedVideo).toBe(false);

        // Step 4: Build Resolve Revision Markers
        const markers = buildResolveRevisionMarkers(diffResult.clips, revisionMap, 24);
        expect(markers.length).toBe(4);

        // Verify marker colors, names, and notes
        expect(markers[0].name).toBe('card-fountain-1');
        expect(markers[0].color).toBe(REVISION_RESOLVE_COLOR_MAP.unchanged);
        expect(markers[0].note).toContain('[UNCHANGED]');

        expect(markers[1].name).toBe('card-fountain-2');
        expect(markers[1].color).toBe(REVISION_RESOLVE_COLOR_MAP.changed);
        expect(markers[1].note).toContain('[CHANGED]');

        expect(markers[2].name).toBe('card-fountain-3');
        expect(markers[2].color).toBe(REVISION_RESOLVE_COLOR_MAP.unchanged);
        expect(markers[2].note).toContain('[UNCHANGED]');

        expect(markers[3].name).toBe('card-fountain-4');
        expect(markers[3].color).toBe(REVISION_RESOLVE_COLOR_MAP.new);
        expect(markers[3].note).toContain('[NEW]');

        // Step 5: Filter ComfyUI queue to skip unchanged cards
        const queuePlan = filterClipsForGeneration(diffResult.clips, revisionMap);
        
        // Unchanged clips (Scenes 1 and 3) must be skipped!
        expect(queuePlan.skippedClips.length).toBe(2);
        expect(queuePlan.skippedClips.map(c => c.id)).toEqual(['card-fountain-1', 'card-fountain-3']);

        // Only changed (Scene 2) and new (Scene 4) clips should be queued for generation!
        expect(queuePlan.clipsToGenerate.length).toBe(2);
        expect(queuePlan.clipsToGenerate.map(c => c.id)).toEqual(['card-fountain-2', 'card-fountain-4']);
    });

    it('ensures whitespace-only edits in action prompts or dialogue are not flagged as changes', () => {
        const renderedClip: VideoClip = {
            id: 'card-ws-test',
            startTime: 0,
            duration: 4.0,
            endTime: 4.0,
            track: 1,
            status: 'done',
            source: 'main',
            label: 'Shot 1',
            notes: { action: 'Neon skyline with pouring rain.', dialogue: 'Singing in the rain', sound: '' },
            videoPath: 'C:\\media\\shot1.mp4'
        };

        const baselineFp = computeCardGenerativeFingerprint(renderedClip);
        renderedClip.lastRenderedFingerprint = baselineFp;

        // Baseline evaluation should be 'unchanged'
        expect(evaluateClipRevision(renderedClip)).toBe('unchanged');

        // Clip edited with trailing, leading, and newline whitespace
        const whitespaceEditedClip: VideoClip = {
            ...renderedClip,
            notes: {
                action: '  \n Neon skyline with pouring rain. \t ',
                dialogue: ' Singing in the rain \n\n ',
                sound: ''
            }
        };

        const editedFp = computeCardGenerativeFingerprint(whitespaceEditedClip);
        expect(editedFp).toBe(baselineFp); // Fingerprint is identical!
        expect(evaluateClipRevision(whitespaceEditedClip)).toBe('unchanged'); // NOT flagged as changed!
    });

    it('evaluates project revisions with external baselineSnapshots dictionary', () => {
        const clipA: VideoClip = {
            id: 'card-a',
            startTime: 0,
            duration: 4.0,
            endTime: 4.0,
            track: 1,
            status: 'done',
            source: 'main',
            label: 'Shot A',
            notes: { action: 'Scene A action', dialogue: '', sound: '' },
            videoPath: 'C:\\media\\a.mp4'
        };

        const clipB: VideoClip = {
            id: 'card-b',
            startTime: 4.0,
            duration: 4.0,
            endTime: 8.0,
            track: 2,
            status: 'done',
            source: 'main',
            label: 'Shot B',
            notes: { action: 'Scene B action edited', dialogue: '', sound: '' },
            videoPath: 'C:\\media\\b.mp4'
        };

        const baselineSnapshots: Record<string, string> = {
            'card-a': computeCardGenerativeFingerprint(clipA),
            'card-b': 'fp-stale-hash-123' // Differs from current prompt!
        };

        const revisionMap = evaluateProjectRevisions([clipA, clipB], baselineSnapshots);

        expect(revisionMap.get('card-a')?.state).toBe('unchanged');
        expect(revisionMap.get('card-a')?.resolveColor).toBe('Green');

        expect(revisionMap.get('card-b')?.state).toBe('changed');
        expect(revisionMap.get('card-b')?.resolveColor).toBe('Yellow');
    });
});
