/**
 * src/services/fountainParser.test.ts
 * 
 * Unit tests for Phase 1 Fountain Screenplay parsing into Resolver sections and storyboard cards.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseFountainScript, normalizeSectionType } from './fountainParser';
import { buildMiniMaxH3UserPrompt } from './qwenPromptService';

describe('fountainParser', () => {
    it('normalizes section titles to canonical SectionTypes', () => {
        expect(normalizeSectionType('Verse 1')).toBe('verse');
        expect(normalizeSectionType('VERSE')).toBe('verse');
        expect(normalizeSectionType('Pre-Chorus')).toBe('pre-chorus');
        expect(normalizeSectionType('Chorus A')).toBe('chorus');
        expect(normalizeSectionType('The Hook')).toBe('chorus');
        expect(normalizeSectionType('Bridge')).toBe('bridge');
        expect(normalizeSectionType('Intro Beat')).toBe('intro');
        expect(normalizeSectionType('Outro / Coda')).toBe('outro');
        expect(normalizeSectionType('Heavy Drop / Breakdown')).toBe('breakdown');
        expect(normalizeSectionType('Guitar Solo')).toBe('solo');
    });

    it('parses fixture file with 3 sections, synopses, and notes', () => {
        const fixture_path = path.resolve(process.cwd(), 'fixtures/fountain/01_sections_synopses.fountain');
        const fixture_content = fs.readFileSync(fixture_path, 'utf8');

        const parsed = parseFountainScript(fixture_content, { frameRate: 24 });

        expect(parsed.title).toBe('Neon Horizon Music Video');
        expect(parsed.author).toBe('Director');

        // Requirement: 3 sections produced
        expect(parsed.sections.length).toBe(3);
        expect(parsed.sections[0].name).toBe('Verse 1');
        expect(parsed.sections[0].type).toBe('verse');

        expect(parsed.sections[1].name).toBe('Chorus');
        expect(parsed.sections[1].type).toBe('chorus');

        expect(parsed.sections[2].name).toBe('Bridge');
        expect(parsed.sections[2].type).toBe('bridge');

        // Requirement: Grouped cards with synopses as short prompt seed
        expect(parsed.clips.length).toBe(3);

        const card1 = parsed.clips[0];
        expect(card1.sceneNumber).toBe('1');
        expect(card1.sectionName).toBe('Verse 1');
        expect(card1.sectionType).toBe('verse');
        // Synopsis mapped into notes.action
        expect(card1.notes?.action).toContain('Rain-soaked pavement reflecting cyan neon signs');
        // Notes kept out of notes.action
        expect(card1.notes?.action).not.toContain('35mm anamorphic');
        expect(card1.notes?.action).not.toContain('[[');
        expect(card1.scriptNotes).toEqual(['Camera: 35mm anamorphic, slow push in, shallow depth of field']);
        expect(card1.notes?.dialogue).toContain('Walking through the midnight haze.');

        const card2 = parsed.clips[1];
        expect(card2.sceneNumber).toBe('2');
        expect(card2.sectionName).toBe('Chorus');
        expect(card2.sectionType).toBe('chorus');
        expect(card2.notes?.action).toContain('High-energy magenta strobe lights pulsing');
        expect(card2.notes?.action).not.toContain('Fast shutter');
        expect(card2.scriptNotes?.length).toBe(1);

        const card3 = parsed.clips[2];
        expect(card3.sceneNumber).toBe('3');
        expect(card3.sectionName).toBe('Bridge');
        expect(card3.sectionType).toBe('bridge');
        expect(card3.notes?.action).toContain('Solitary figure bathed in flickering amber emergency beacons');
        expect(card3.notes?.action).not.toContain('high contrast');

        // Timeline ripple validation: gapless sequential time
        expect(card1.startTime).toBe(0);
        expect(card1.endTime).toBeGreaterThan(0);
        expect(card2.startTime).toBe(card1.endTime);
        expect(card3.startTime).toBe(card2.endTime);

        // Section timeline spans encompass the cards
        expect(parsed.sections[0].startTime).toBe(card1.startTime);
        expect(parsed.sections[0].endTime).toBe(card1.endTime);
        expect(parsed.sections[1].startTime).toBe(card2.startTime);
        expect(parsed.sections[1].endTime).toBe(card2.endTime);
        expect(parsed.sections[2].startTime).toBe(card3.startTime);
        expect(parsed.sections[2].endTime).toBe(card3.endTime);
    });

    it('feeds synopsis into AI expansion seed and keeps [[notes]] out of action directive', () => {
        const fixture_path = path.resolve(process.cwd(), 'fixtures/fountain/01_sections_synopses.fountain');
        const fixture_content = fs.readFileSync(fixture_path, 'utf8');
        const parsed = parseFountainScript(fixture_content, { frameRate: 24 });

        const first_clip = parsed.clips[0];

        // Generate user prompt for AI cinematic expansion
        const prompt = buildMiniMaxH3UserPrompt(first_clip, 24);

        // Done condition: expansion uses the synopsis text
        expect(prompt).toContain("Director's Action Directive:");
        expect(prompt).toContain('Rain-soaked pavement reflecting cyan neon signs');

        // Verification: bracketed raw [[ ]] note is NOT in the action directive
        expect(prompt).not.toContain('[[Camera:');
        expect(prompt).not.toContain('[[Director note:');
    });

    it('handles empty input and whitespace-only strings gracefully', () => {
        const emptyResult = parseFountainScript('');
        expect(emptyResult.title).toBe('Untitled Storyboard');
        expect(emptyResult.author).toBe('Director');
        expect(emptyResult.sections.length).toBe(0);
        expect(emptyResult.clips.length).toBe(0);

        const whitespaceResult = parseFountainScript('   \n\n\t  \r\n   ');
        expect(whitespaceResult.sections.length).toBe(0);
        expect(whitespaceResult.clips.length).toBe(0);
    });

    it('parses CRLF (Windows) and LF (Unix) line endings identically', () => {
        const lfScript = "Title: Test Cut\r\nAuthor: Writer\r\n\r\n# Verse\r\n\r\n.STAGE - NIGHT #1#\r\n= Singer performs.\r\nMARCUS\r\nHello world.";
        const crlfScript = lfScript.replace(/\n/g, '\r\n');

        const parsedLf = parseFountainScript(lfScript);
        const parsedCrlf = parseFountainScript(crlfScript);

        expect(parsedCrlf.title).toBe(parsedLf.title);
        expect(parsedCrlf.clips.length).toBe(parsedLf.clips.length);
        expect(parsedCrlf.clips[0].notes?.action).toBe(parsedLf.clips[0].notes?.action);
        expect(parsedCrlf.clips[0].notes?.dialogue).toBe(parsedLf.clips[0].notes?.dialogue);
    });

    it('gracefully handles unclosed boneyard at EOF', () => {
        const unclosedScript = `
Title: Unclosed Boneyard
Author: Director

# Verse 1

.WAREHOUSE - NIGHT #1#
= Marcus steps into rain.

/*
.CUT SCENE - NIGHT #2#
= Alternate angle discarded.
`;
        const parsed = parseFountainScript(unclosedScript);
        expect(parsed.clips.length).toBe(2);
        expect(parsed.clips[0].sceneNumber).toBe('1');
        expect(parsed.clips[0].isMuted).toBe(false);
        expect(parsed.clips[1].sceneNumber).toBe('2');
        expect(parsed.clips[1].isMuted).toBe(true);
    });

    it('prunes empty sections that contain no scenes', () => {
        const scriptWithEmptySection = `
# Intro

# Verse 1

.STUDIO - DAY #1#
= Opening beat drops.
`;
        const parsed = parseFountainScript(scriptWithEmptySection);
        // "Intro" has no scenes, so only "Verse 1" should be committed
        expect(parsed.sections.length).toBe(1);
        expect(parsed.sections[0].name).toBe('Verse 1');
        expect(parsed.clips.length).toBe(1);
    });

    it('strips inline [[notes]] from dialogue and registers them in scriptNotes', () => {
        const scriptWithInlineNotes = `
.STAGE - NIGHT #1#
= Performance shot.
MARCUS
(singing)
Walking through the haze [[Cut to crowd on beat 4]] into the light.
`;
        const parsed = parseFountainScript(scriptWithInlineNotes);
        const clip = parsed.clips[0];
        expect(clip.scriptNotes).toContain('Cut to crowd on beat 4');
        expect(clip.notes?.dialogue).toContain('Walking through the haze into the light.');
        expect(clip.notes?.dialogue).not.toContain('[[');
        expect(clip.notes?.dialogue).not.toContain(']]');
        expect(clip.notes?.sound).toBe('Delivery: singing');
    });

    it('auto-assigns sequential scene numbers when scenes lack explicit #number# tags', () => {
        const unnumberedScript = `
# Verse

INT. FIRST ROOM - NIGHT
= Scene one.

EXT. ALLEYWAY - NIGHT
= Scene two.
`;
        const parsed = parseFountainScript(unnumberedScript);
        expect(parsed.clips.length).toBe(2);
        expect(parsed.clips[0].sceneNumber).toBe('1');
        expect(parsed.clips[0].id).toBe('card-fountain-1');
        expect(parsed.clips[1].sceneNumber).toBe('2');
        expect(parsed.clips[1].id).toBe('card-fountain-2');
    });

    it('correctly maps camera optics, dolly movement, and vfx keywords from notes', () => {
        const keywordScript = `
.CYBERPUNK ALLEY - NIGHT #10#
= Rain puddles reflecting neon.
[[Lens: 35mm anamorphic wide]]
[[Dolly: slow handheld push]]
[[Lighting: high contrast sodium vapor strobe]]
`;
        const parsed = parseFountainScript(keywordScript);
        const clip = parsed.clips[0];
        expect(clip.optics).toContain('35mm anamorphic');
        expect(clip.cameraMovement).toContain('slow handheld push');
        expect(clip.vfxNotes).toContain('high contrast sodium vapor strobe');
    });

    it('supports forced character cues (@name) and default prose as action synopsis', () => {
        const forcedCueScript = `
.CLUB - NIGHT #1#
The neon sign buzzes in the foggy room.
@Dancer
Spinning under the strobe.
`;
        const parsed = parseFountainScript(forcedCueScript);
        const clip = parsed.clips[0];
        expect(clip.notes?.action).toBe('The neon sign buzzes in the foggy room.');
        expect(clip.notes?.dialogue).toBe('Spinning under the strobe.');
    });
});
