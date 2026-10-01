/**
 * src/services/boneyardAlternates.test.ts
 * 
 * Unit tests for Phase 4:
 * - Fountain Boneyard syntax (/* ... *\/) mapping to muted alternate takes
 * - Timeline alignment of alternate takes without stretching active cut duration
 * - Manifest export filtering of muted takes for timeline assembly
 * - ComfyUI generation queue skipping of muted/boneyard cards
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseFountainScript } from './fountainParser';
import { generateMusicVideoManifest } from './manifestService';
import { filterClipsForGeneration, evaluateProjectRevisions } from './revisionDiffService';
import type { BeatProject } from '../hooks/useProjectStorage';

describe('Phase 4: Boneyard Syntax & Alternate Takes', () => {
    it('parses boneyard scenes as muted alternate takes aligned with the active take', () => {
        const fixturePath = path.resolve(process.cwd(), 'fixtures/fountain/04_boneyard_alternates.fountain');
        const fountainText = fs.readFileSync(fixturePath, 'utf8');

        const result = parseFountainScript(fountainText, { frameRate: 24, defaultShotDurationSeconds: 4.0 });

        // Must have 3 sections: Verse 1, Chorus, Bridge
        expect(result.sections.length).toBe(3);
        expect(result.sections[0].name).toBe('Verse 1');
        expect(result.sections[1].name).toBe('Chorus');
        expect(result.sections[2].name).toBe('Bridge');

        // Total 4 cards parsed: Scene 1, Scene 2A (active), Scene 2B (boneyard alt), Scene 3
        expect(result.clips.length).toBe(4);

        const card1 = result.clips[0];
        const card2A = result.clips[1];
        const card2B = result.clips[2];
        const card3 = result.clips[3];

        // Scene 1: Active in Verse 1
        expect(card1.sceneNumber).toBe('1');
        expect(card1.isMuted).toBe(false);
        expect(card1.startTime).toBe(0.0);
        expect(card1.endTime).toBe(card1.duration);

        // Scene 2A: Active take in Chorus
        expect(card2A.sceneNumber).toBe('2A');
        expect(card2A.isMuted).toBe(false);
        expect(card2A.startTime).toBe(card1.endTime);
        expect(card2A.endTime).toBe(card2A.startTime + card2A.duration);
        expect(card2A.notes?.action).toContain('High-energy magenta strobe lights');

        // Scene 2B: Boneyard alternate take in Chorus
        expect(card2B.sceneNumber).toBe('2B');
        expect(card2B.isMuted).toBe(true); // MUST BE MUTED!
        expect(card2B.startTime).toBe(card2A.startTime); // Aligns with active take 2A!
        expect(card2B.endTime).toBe(card2B.startTime + card2B.duration);
        expect(card2B.notes?.action).toContain('Extreme top-down drone shot descending');
        expect(card2B.scriptNotes).toContain('Alternate Take: Drone spinning descent');

        // Scene 3: Active in Bridge
        expect(card3.sceneNumber).toBe('3');
        expect(card3.isMuted).toBe(false);
        expect(card3.startTime).toBe(card2A.endTime); // Continues directly after 2A (NOT after 2B)!
        expect(card3.endTime).toBe(card3.startTime + card3.duration);

        // Verify total project duration is NOT stretched by the alternate take (equals card3.endTime)
        const totalDuration = result.sections[result.sections.length - 1].endTime;
        expect(totalDuration).toBe(card3.endTime);
    });

    it('excludes muted alternate takes from default assembly manifest and includes when requested', () => {
        const fixturePath = path.resolve(process.cwd(), 'fixtures/fountain/04_boneyard_alternates.fountain');
        const fountainText = fs.readFileSync(fixturePath, 'utf8');
        const parseResult = parseFountainScript(fountainText, { frameRate: 24, defaultShotDurationSeconds: 4.0 });

        const mockProject: BeatProject = {
            id: 'proj-boneyard-test',
            name: 'Neon Horizon Alternates',
            duration: 12.0,
            frameRate: 24,
            audioPath: 'C:\\Audio\\track.wav',
            stemType: 'full',
            sections: parseResult.sections,
            clips: parseResult.clips,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // 1. Default manifest export: must exclude muted boneyard take (Scene 2B)
        const defaultManifest = generateMusicVideoManifest(mockProject);
        expect(defaultManifest.clips.length).toBe(3);
        expect(defaultManifest.clips.map(c => c.scene_number)).toEqual(['1', '2A', '3']);
        expect(defaultManifest.clips.some(c => c.scene_number === '2B')).toBe(false);

        // 2. Explicit includeMuted manifest export: includes Scene 2B with is_muted: true
        const fullManifest = generateMusicVideoManifest(mockProject, undefined, { includeMuted: true });
        expect(fullManifest.clips.length).toBe(4);
        
        const boneyardEntry = fullManifest.clips.find(c => c.scene_number === '2B');
        expect(boneyardEntry).toBeDefined();
        expect(boneyardEntry?.is_muted).toBe(true);
        expect(boneyardEntry?.display_name).toContain('2B');
    });

    it('skips muted alternate takes during ComfyUI batch generation queueing', () => {
        const fixturePath = path.resolve(process.cwd(), 'fixtures/fountain/04_boneyard_alternates.fountain');
        const fountainText = fs.readFileSync(fixturePath, 'utf8');
        const parseResult = parseFountainScript(fountainText, { frameRate: 24, defaultShotDurationSeconds: 4.0 });

        const revisionMap = evaluateProjectRevisions(parseResult.clips);
        const queuePlan = filterClipsForGeneration(parseResult.clips, revisionMap);

        // Scene 2B is muted, so even though it has never been rendered, it must be SKIPPED!
        expect(queuePlan.skippedClips.some(c => c.sceneNumber === '2B')).toBe(true);

        // Only active scenes 1, 2A, and 3 should be queued for generation
        expect(queuePlan.clipsToGenerate.map(c => c.sceneNumber)).toEqual(['1', '2A', '3']);
    });
});
