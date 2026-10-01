/**
 * src/services/manifestService.test.ts
 * 
 * Unit tests for Phase 2: Stable Card IDs across reordering and manifest generation.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseFountainScript } from './fountainParser';
import { generateMusicVideoManifest } from './manifestService';
import type { BeatProject } from '../hooks/useProjectStorage';
import type { VideoClip } from '../types/assembler';

describe('Phase 2: Stable Card IDs & Manifest Generation', () => {
    it('preserves stable IDs and generated media when cards are reordered in Fountain', () => {
        // Step 1: Initial import of 01_sections_synopses.fountain (#1#, #2#, #3#)
        const initial_fixture_path = path.resolve(process.cwd(), 'fixtures/fountain/01_sections_synopses.fountain');
        const initial_fountain_text = fs.readFileSync(initial_fixture_path, 'utf8');

        const initial_result = parseFountainScript(initial_fountain_text, { frameRate: 24 });
        expect(initial_result.clips.length).toBe(3);

        const initial_card1 = initial_result.clips[0];
        const initial_card2 = initial_result.clips[1];
        const initial_card3 = initial_result.clips[2];

        expect(initial_card1.id).toBe('card-fountain-1');
        expect(initial_card1.sceneNumber).toBe('1');
        expect(initial_card1.startTime).toBe(0);

        expect(initial_card2.id).toBe('card-fountain-2');
        expect(initial_card2.sceneNumber).toBe('2');
        expect(initial_card2.startTime).toBe(initial_card1.endTime);

        expect(initial_card3.id).toBe('card-fountain-3');
        expect(initial_card3.sceneNumber).toBe('3');

        // Simulate that Scene 2 has generated a video render in ComfyUI
        initial_card2.videoPath = 'C:\\Resolver\\output\\rooftop_take1.mp4';
        initial_card2.status = 'done';
        initial_card2.aiExpandedPrompt = 'Cinematic rooftop dancers under vibrant neon light.';

        // Step 2: Re-import reordered Fountain file where Scene #2# comes first!
        const reordered_fixture_path = path.resolve(process.cwd(), 'fixtures/fountain/02_stable_ids.fountain');
        const reordered_fountain_text = fs.readFileSync(reordered_fixture_path, 'utf8');

        const reordered_result = parseFountainScript(reordered_fountain_text, {
            frameRate: 24,
            existingClips: [initial_card1, initial_card2, initial_card3]
        });

        expect(reordered_result.clips.length).toBe(3);

        // Verification 1: First clip is now Scene 2, but its ID remains card-fountain-2
        const reordered_first_clip = reordered_result.clips[0];
        expect(reordered_first_clip.sceneNumber).toBe('2');
        expect(reordered_first_clip.id).toBe('card-fountain-2'); // STABLE ID PRESERVED!
        expect(reordered_first_clip.videoPath).toBe('C:\\Resolver\\output\\rooftop_take1.mp4'); // ASSET PRESERVED!
        expect(reordered_first_clip.aiExpandedPrompt).toBe('Cinematic rooftop dancers under vibrant neon light.');
        expect(reordered_first_clip.startTime).toBe(0); // Timeline position updated to front!

        // Verification 2: Second clip is now Scene 1, retaining card-fountain-1
        const reordered_second_clip = reordered_result.clips[1];
        expect(reordered_second_clip.sceneNumber).toBe('1');
        expect(reordered_second_clip.id).toBe('card-fountain-1'); // STABLE ID PRESERVED!
        expect(reordered_second_clip.startTime).toBe(reordered_first_clip.endTime); // Ripple synced!

        // Verification 3: Third clip is Scene 3, retaining card-fountain-3
        const reordered_third_clip = reordered_result.clips[2];
        expect(reordered_third_clip.sceneNumber).toBe('3');
        expect(reordered_third_clip.id).toBe('card-fountain-3'); // STABLE ID PRESERVED!
    });

    it('generates canonical music_video_manifest.json with stable IDs in clip names', () => {
        const mockProject: BeatProject = {
            id: 'proj-stable-ids-test',
            name: 'Neon Horizon Cut',
            duration: 12.0,
            frameRate: 24,
            audioPath: 'C:\\Audio\\track.wav',
            stemType: 'full',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            clips: [
                {
                    id: 'card-fountain-2',
                    startTime: 0,
                    duration: 4.0,
                    endTime: 4.0,
                    track: 1,
                    status: 'done',
                    source: 'main',
                    label: 'Shot 2',
                    sceneNumber: '2',
                    shotLetter: 'A',
                    videoPath: 'C:\\Resolver\\output\\rooftop_take1.mp4',
                    sectionName: 'Chorus',
                    sectionType: 'chorus',
                    notes: { action: 'High-energy magenta strobe lights', dialogue: 'We ignite the neon horizon', sound: '' }
                },
                {
                    id: 'card-fountain-1',
                    startTime: 4.0,
                    duration: 4.0,
                    endTime: 8.0,
                    track: 2,
                    status: 'pending',
                    source: 'main',
                    label: 'Shot 1',
                    sceneNumber: '1',
                    shotLetter: 'A',
                    videoPath: 'C:\\Resolver\\output\\warehouse_take1.mp4',
                    sectionName: 'Verse 1',
                    sectionType: 'verse',
                    notes: { action: 'Rain-soaked pavement', dialogue: 'Walking through midnight', sound: '' }
                }
            ]
        };

        const manifest = generateMusicVideoManifest(mockProject);

        expect(manifest.project_name).toBe('Neon Horizon Cut');
        expect(manifest.project_fps).toBe(24);
        expect(manifest.audio_path).toBe('C:\\Audio\\track.wav');
        expect(manifest.clips.length).toBe(2);

        // Verification: Clip 1 in manifest matches Scene 2 with display_name containing stable ID
        const first_entry = manifest.clips[0];
        expect(first_entry.id).toBe('card-fountain-2');
        expect(first_entry.display_name).toBe('[card-fountain-2] Shot 2');
        expect(first_entry.path).toBe('C:\\Resolver\\output\\rooftop_take1.mp4');
        expect(first_entry.start_seconds).toBe(0.0);
        expect(first_entry.end_seconds).toBe(4.0);

        // Verification: Clip 2 in manifest matches Scene 1 with display_name containing stable ID
        const second_entry = manifest.clips[1];
        expect(second_entry.id).toBe('card-fountain-1');
        expect(second_entry.display_name).toBe('[card-fountain-1] Shot 1');
        expect(second_entry.path).toBe('C:\\Resolver\\output\\warehouse_take1.mp4');
        expect(second_entry.start_seconds).toBe(4.0);
        expect(second_entry.end_seconds).toBe(8.0);
    });

    it('handles all optional field fallbacks, alternating tracks, and empty clips', () => {
        // Minimal project with undefined clips and empty options
        const emptyProject: BeatProject = {
            id: 'proj-empty',
            name: '',
            duration: 0,
            frameRate: 0,
            stemType: 'full',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            clips: undefined
        };

        const emptyManifest = generateMusicVideoManifest(emptyProject);
        expect(emptyManifest.project_name).toBe('Untitled Project');
        expect(emptyManifest.project_fps).toBe(24);
        expect(emptyManifest.audio_path).toBe('');
        expect(emptyManifest.total_duration_seconds).toBe(0);
        expect(emptyManifest.clips).toEqual([]);

        // Project with duration but empty clips array
        const durationOnlyProject: BeatProject = {
            ...emptyProject,
            duration: 15.5,
            clips: []
        };
        const durationManifest = generateMusicVideoManifest(durationOnlyProject);
        expect(durationManifest.total_duration_seconds).toBe(15.5);

        // Clips with missing sceneNumber, shotLetter, label, id, videoPath, notes, and track
        const sparseClips: VideoClip[] = [
            {
                id: '',
                startTime: 0,
                duration: 3.5,
                endTime: 3.5,
                track: 0,
                status: 'pending',
                source: 'main',
                label: ''
                // notes undefined, videoPath undefined, sceneNumber undefined
            },
            {
                id: '',
                startTime: 3.5,
                duration: 2.5,
                endTime: 6.0,
                track: 0,
                status: 'pending',
                source: 'main',
                label: ''
            }
        ];

        const sparseManifest = generateMusicVideoManifest(emptyProject, sparseClips);
        expect(sparseManifest.clips.length).toBe(2);

        // First sparse clip: index 0 -> scene 1, track 1 (even index)
        const entry1 = sparseManifest.clips[0];
        expect(entry1.scene_number).toBe('1');
        expect(entry1.shot_letter).toBe('A');
        expect(entry1.label).toBe('Shot 1');
        expect(entry1.id).toBe('card-fountain-1');
        expect(entry1.display_name).toBe('[card-fountain-1] Shot 1');
        expect(entry1.path).toBe('');
        expect(entry1.track).toBe(1);
        expect(entry1.action_directive).toBe('');
        expect(entry1.dialogue).toBe('');

        // Second sparse clip: index 1 -> scene 2, track 2 (odd index)
        const entry2 = sparseManifest.clips[1];
        expect(entry2.scene_number).toBe('2');
        expect(entry2.shot_letter).toBe('A');
        expect(entry2.label).toBe('Shot 2');
        expect(entry2.id).toBe('card-fountain-2');
        expect(entry2.display_name).toBe('[card-fountain-2] Shot 2');
        expect(entry2.track).toBe(2);
        expect(sparseManifest.total_duration_seconds).toBe(6.0);
    });

    it('asserts canonical manifest schema contract matching DaVinci Resolve Python assembler', () => {
        const testProject: BeatProject = {
            id: 'proj-contract-test',
            name: 'Resolver Contract Cut',
            duration: 8.0,
            frameRate: 29.97,
            audioPath: '/audio/test.wav',
            stemType: 'full',
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
            clips: [
                {
                    id: 'card-fountain-1',
                    startTime: 0,
                    duration: 4.0,
                    endTime: 4.0,
                    track: 1,
                    status: 'done',
                    source: 'main',
                    label: 'Shot 1',
                    sceneNumber: '1',
                    shotLetter: 'A',
                    sectionName: 'Verse 1',
                    sectionType: 'verse',
                    videoPath: '/media/shot1.mp4',
                    notes: { action: 'Opening beat', dialogue: 'Lyrics line', sound: '' }
                },
                {
                    id: 'card-fountain-2',
                    startTime: 4.0,
                    duration: 4.0,
                    endTime: 8.0,
                    track: 2,
                    status: 'done',
                    source: 'main',
                    label: 'Shot 2',
                    sceneNumber: '2',
                    shotLetter: 'B',
                    isMuted: true,
                    videoPath: '/media/shot2_alt.mp4',
                    notes: { action: 'Alternate take', dialogue: '', sound: '' }
                }
            ]
        };

        // 1. By default, muted take is excluded
        const activeManifest = generateMusicVideoManifest(testProject);
        expect(activeManifest.clips.length).toBe(1);
        expect(activeManifest.clips[0].id).toBe('card-fountain-1');

        // 2. With includeMuted: true, both clips included and contract keys verified
        const fullManifest = generateMusicVideoManifest(testProject, undefined, { includeMuted: true });
        expect(fullManifest.project_id).toBe('proj-contract-test');
        expect(fullManifest.project_fps).toBe(29.97);
        expect(fullManifest.audio_path).toBe('/audio/test.wav');
        expect(fullManifest.clips.length).toBe(2);

        const keys = Object.keys(fullManifest.clips[0]).sort();
        expect(keys).toEqual([
            'action_directive',
            'dialogue',
            'display_name',
            'duration',
            'end_seconds',
            'id',
            'is_muted',
            'label',
            'path',
            'scene_number',
            'section_name',
            'section_type',
            'shot_letter',
            'start_seconds',
            'track'
        ].sort());
    });
});
