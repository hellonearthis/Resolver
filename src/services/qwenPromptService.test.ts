import { describe, it, expect } from 'vitest';
import {
    IMAGE_FUNCTION_REGISTRY,
    getImageFunctionConfiguration,
    buildQwenVisionPromptForFunction,
    buildMiniMaxH3SystemPrompt,
    buildMiniMaxH3UserPrompt,
    buildMiniMaxH3DirectBrief,
} from './qwenPromptService';
import type { ImageFunction, VideoClip } from '../types/assembler';

describe('qwenPromptService', () => {
    // ---------------------------------------------------------------------------
    // Registry and Configuration Lookups
    // ---------------------------------------------------------------------------
    describe('getImageFunctionConfiguration', () => {
        it('returns configuration for all defined image functions', () => {
            expect(Object.keys(IMAGE_FUNCTION_REGISTRY)).toHaveLength(6);
            const allImageFunctions: ImageFunction[] = [
                'start_frame',
                'end_frame',
                'character_reference',
                'scene_reference',
                'shot_style',
                'storyboard_action',
            ];

            for (const imageFunction of allImageFunctions) {
                const config = getImageFunctionConfiguration(imageFunction);
                expect(config.identifier).toBe(imageFunction);
                expect(config.displayName).toBeTruthy();
                expect(config.iconEmoji).toBeTruthy();
                expect(config.briefExplanation).toBeTruthy();
                expect(config.borderClass).toContain('border-');
            }
        });

        it('falls back gracefully to start_frame when undefined or unrecognized', () => {
            const fallbackConfiguration = getImageFunctionConfiguration(undefined);
            expect(fallbackConfiguration.identifier).toBe('start_frame');
            expect(fallbackConfiguration.displayName).toBe('Start Frame');

            const invalidKeyConfiguration = getImageFunctionConfiguration('unknown_function' as unknown as ImageFunction);
            expect(invalidKeyConfiguration.identifier).toBe('start_frame');
        });
    });

    // ---------------------------------------------------------------------------
    // Prompt Building for Distinct Functional Roles
    // ---------------------------------------------------------------------------
    describe('buildQwenVisionPromptForFunction', () => {
        it('generates start_frame prompt with opening anchor rules', () => {
            const prompt = buildQwenVisionPromptForFunction('start_frame');
            expect(prompt).toContain('OPENING FIRST-FRAME ANCHOR (<Picture 1>)');
            expect(prompt).toContain('MiniMax H3 video diffusion model');
            expect(prompt).toContain('millisecond-zero physical ground truth');
        });

        it('generates end_frame prompt with destination arrival rules', () => {
            const prompt = buildQwenVisionPromptForFunction('end_frame');
            expect(prompt).toContain('CONCLUDING TERMINAL FRAME (<Picture 2>)');
            expect(prompt).toContain('FL2VA');
            expect(prompt).toContain('Destination Arrival Composition');
        });

        it('generates character_reference prompt with strict biometric and clothing rules and background exclusion', () => {
            const prompt = buildQwenVisionPromptForFunction('character_reference');
            expect(prompt).toContain('CHARACTER IDENTITY REFERENCE (<Picture N> / <Subject N>)');
            expect(prompt).toContain('Biometric Invariants');
            expect(prompt).toContain('STRICTLY DISREGARD the photo background');
        });

        it('generates scene_reference prompt with architectural rules and person exclusion', () => {
            const prompt = buildQwenVisionPromptForFunction('scene_reference');
            expect(prompt).toContain('ENVIRONMENT / LOCATION REFERENCE (<Picture N>)');
            expect(prompt).toContain('Spatial Geometry & Architecture');
            expect(prompt).toContain('STRICTLY DISREGARD transient human subjects');
        });

        it('generates shot_style prompt with cinematographic lighting, palette, and lens rules', () => {
            const prompt = buildQwenVisionPromptForFunction('shot_style');
            expect(prompt).toContain('CINEMATOGRAPHY / SHOT STYLE REFERENCE (<Picture N>)');
            expect(prompt).toContain('Lighting Architecture');
            expect(prompt).toContain('Color Palette & Grade');
            expect(prompt).toContain('Lens & Optical Physics');
        });

        it('generates storyboard_action prompt with motion vector and blocking rules', () => {
            const prompt = buildQwenVisionPromptForFunction('storyboard_action');
            expect(prompt).toContain('STORYBOARD ACTION / MOTION BLOCKING SKETCH (<Picture N>)');
            expect(prompt).toContain('Kinetic Vectors & Blocking');
            expect(prompt).toContain('Drawn Storyboard Symbols');
        });

        it('incorporates director intent context when provided', () => {
            const prompt = buildQwenVisionPromptForFunction('character_reference', {
                shotLabel: 'Shot 2B',
                actionIntent: 'Mei looks up in surprise',
                dialogueOrLyrics: '"Who is there?"',
            });

            expect(prompt).toContain('DIRECTOR INTENT CONTEXT:');
            expect(prompt).toContain('Shot Label: Shot 2B');
            expect(prompt).toContain("Director's Planned Action: Mei looks up in surprise");
            expect(prompt).toContain('Dialogue / Song Lyrics: "Who is there?"');
        });
    });

    // ---------------------------------------------------------------------------
    // MiniMax H3 System Prompt Generation
    // ---------------------------------------------------------------------------
    describe('buildMiniMaxH3SystemPrompt', () => {
        it('generates single-reference I2VA instructions with start frame anchor rules', () => {
            const system_prompt = buildMiniMaxH3SystemPrompt({
                isDualReference: false,
                startRole: 'start_frame',
            });

            expect(system_prompt).toContain('OPERATING MODE: Image-to-Video (I2VA) with Single Reference Image');
            expect(system_prompt).toContain('Image 1 (<Picture 1>) assigned role: Start Frame');
            expect(system_prompt).toContain('Anchor the opening composition');
            expect(system_prompt).toContain("🚫 NO 'AT' OR 'FROM' ABSOLUTE CLOCK TIMECODES");
            expect(system_prompt).toContain('🚫 NO <d> TAGS FOR DIALOGUE');
            expect(system_prompt).toContain('🚫 NO BRACKETED CAMERA SYNTAX');
        });

        it('generates dual-reference R2V instructions with role-specific constraints', () => {
            const system_prompt = buildMiniMaxH3SystemPrompt({
                isDualReference: true,
                startRole: 'character_reference',
                endRole: 'scene_reference',
            });

            expect(system_prompt).toContain('OPERATING MODE: Reference-to-Video (R2V) with Dual Reference Images');
            expect(system_prompt).toContain('Image 1 (<Picture 1>) assigned role: Character Ref');
            expect(system_prompt).toContain('Image 2 (<Picture 2>) assigned role: Scene Ref');
            expect(system_prompt).toContain('Reference Locks:');
            expect(system_prompt).toContain('lock facial bone structure, hairstyle, eye color');
            expect(system_prompt).toContain('lock architectural geometry, spatial set design');
            expect(system_prompt).toContain('[Header & Invariance Contract]');
            expect(system_prompt).toContain('[Action & Cinematography]');
            expect(system_prompt).toContain('[Dialogue & Soundscape]');
            expect(system_prompt).toContain('[Negative Guardrails]');
        });
    });

    // ---------------------------------------------------------------------------
    // MiniMax H3 User Prompt Generation
    // ---------------------------------------------------------------------------
    describe('buildMiniMaxH3UserPrompt', () => {
        it('formats single and dual reference metadata into structured sections', () => {
            const sample_clip: VideoClip = {
                id: 'clip-test-1',
                startTime: 0,
                duration: 4.25,
                endTime: 4.25,
                track: 1,
                status: 'pending',
                source: 'main',
                label: 'Shot 1A',
                startImagePath: 'images/start.jpg',
                startImageFunction: 'character_reference',
                startImageDescription: 'A detective in a trenchcoat in rain.',
                endImagePath: 'images/end.jpg',
                endImageFunction: 'scene_reference',
                endImageDescription: 'A neon-lit alleyway with wet pavement.',
                notes: {
                    action: 'The detective walks into the alley.',
                    dialogue: 'He says, "Nobody move."',
                    sound: 'Heavy rain and footsteps.',
                },
                shotSize: 'Medium Shot',
                cameraMovement: 'Push In',
            };

            const user_prompt = buildMiniMaxH3UserPrompt(sample_clip, 24);

            expect(user_prompt).toContain('Image 1 (Character Ref):');
            expect(user_prompt).toContain('A detective in a trenchcoat in rain.');
            expect(user_prompt).toContain('Image 2 (Scene Ref):');
            expect(user_prompt).toContain('A neon-lit alleyway with wet pavement.');
            expect(user_prompt).toContain("Director's Action Directive:");
            expect(user_prompt).toContain('The detective walks into the alley.');
            expect(user_prompt).toContain('Dialogue / Song Lyrics:');
            expect(user_prompt).toContain('He says, "Nobody move."');
            expect(user_prompt).toContain('Sound / Foley Notes:');
            expect(user_prompt).toContain('Heavy rain and footsteps.');
            expect(user_prompt).toContain('Framing: Medium Shot, Movement: Push In');
            expect(user_prompt).toContain('Target Duration: 4.25 seconds (102 frames at 24 fps)');
        });
    });

    // ---------------------------------------------------------------------------
    // MiniMax H3 Direct Brief Generation
    // ---------------------------------------------------------------------------
    describe('buildMiniMaxH3DirectBrief', () => {
        it('assembles a production-ready brief when no LLM expansion is used', () => {
            const sample_clip: VideoClip = {
                id: 'clip-test-2',
                startTime: 2.0,
                duration: 5.0,
                endTime: 7.0,
                track: 1,
                status: 'pending',
                source: 'main',
                label: 'Shot 2A',
                startImagePath: 'images/frame1.jpg',
                startImageFunction: 'start_frame',
                startImageDescription: 'Close-up of runner tying shoelace.',
                endImagePath: 'images/frame2.jpg',
                endImageFunction: 'end_frame',
                endImageDescription: 'Runner sprinting across finish line.',
                notes: {
                    action: 'Stands up quickly and sprints toward horizon.',
                    dialogue: 'Go now!',
                    sound: 'Heavy breath and crowd cheer.',
                },
                cameraMovement: 'Tracking Shot',
                shotSize: 'Close-Up',
            };

            const direct_brief = buildMiniMaxH3DirectBrief(sample_clip, 24);

            expect(direct_brief).toContain('[Header & Invariance Contract]');
            expect(direct_brief).toContain('Duration: 5.0 seconds');
            expect(direct_brief).toContain('Frame Rate: 24 fps');
            expect(direct_brief).toContain('Image 1 (Start Frame)');
            expect(direct_brief).toContain('Image 2 (End Frame)');
            expect(direct_brief).toContain('[Action & Cinematography]');
            expect(direct_brief).toContain('Stands up quickly and sprints toward horizon.');
            expect(direct_brief).toContain('[Dialogue & Soundscape]');
            expect(direct_brief).toContain('The character speaks with natural clarity and says, "Go now!"');
            expect(direct_brief).toContain('Heavy breath and crowd cheer.');
            expect(direct_brief).toContain('[Negative Guardrails]');
            expect(direct_brief).toContain('No facial morphing or identity blurring');
        });
    });
});
