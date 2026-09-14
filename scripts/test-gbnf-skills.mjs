#!/usr/bin/env node
/**
 * scripts/test-gbnf-skills.mjs
 * 
 * WHAT:
 *   Automated test suite verifying the GBNF Grammar and Skill Injection system.
 *   Tests template interpolation, GBNF grammar files, and strict JSON validation.
 * 
 * WHY:
 *   Validates that prompt skills hydrate context accurately and that the GBNF
 *   structured parser enforces 100% schema integrity without regressions.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    interpolateSkillTemplate,
    parseStructuredStoryboardResponse,
    prepareVisionDescriptionSkillRequest,
    prepareH3DirectorSkillRequest,
    DEFAULT_STORYBOARD_CLIP_GBNF_GRAMMAR
} from '../src/services/llmSkillService.ts';

const current_module_file_path = fileURLToPath(import.meta.url);
const current_scripts_directory_path = path.dirname(current_module_file_path);
const workspace_root_directory_path = path.resolve(current_scripts_directory_path, '..');

async function runGbnfSkillTests() {
    process.stdout.write('⚡ Starting GBNF Grammar & Skill Injection Automated Verification...\n');

    // 1. Verify Grammar File on Disk
    const grammar_file_path = path.join(workspace_root_directory_path, 'prompts', 'grammars', 'storyboard_clip.gbnf');
    if (!fs.existsSync(grammar_file_path)) {
        throw new Error(`Missing GBNF grammar file at: ${grammar_file_path}`);
    }
    const raw_grammar_string = fs.readFileSync(grammar_file_path, 'utf8');
    if (!raw_grammar_string.includes('prompt') || !raw_grammar_string.includes('camera_movement')) {
        throw new Error('GBNF grammar file is missing required storyboard fields.');
    }
    process.stdout.write('  ✓ GBNF grammar file verified on disk (prompts/grammars/storyboard_clip.gbnf).\n');

    // 2. Verify Vision Skill File on Disk
    const vision_skill_file_path = path.join(workspace_root_directory_path, 'prompts', 'skills', 'image_description_qwen.md');
    if (!fs.existsSync(vision_skill_file_path)) {
        throw new Error(`Missing vision skill file at: ${vision_skill_file_path}`);
    }
    const raw_vision_skill_content = fs.readFileSync(vision_skill_file_path, 'utf8');
    if (!raw_vision_skill_content.includes('{{image_role}}')) {
        throw new Error('Vision skill file is missing {{image_role}} slot.');
    }
    process.stdout.write('  ✓ Vision skill file verified on disk (prompts/skills/image_description_qwen.md).\n');

    // 3. Verify H3 Director Skill File on Disk
    const h3_skill_file_path = path.join(workspace_root_directory_path, 'prompts', 'skills', 'minimax_h3_director.md');
    if (!fs.existsSync(h3_skill_file_path)) {
        throw new Error(`Missing H3 director skill file at: ${h3_skill_file_path}`);
    }
    const raw_h3_skill_content = fs.readFileSync(h3_skill_file_path, 'utf8');
    if (!raw_h3_skill_content.includes('{{duration}}') || !raw_h3_skill_content.includes('{{bpm}}')) {
        throw new Error('H3 director skill file is missing duration or bpm slots.');
    }
    process.stdout.write('  ✓ H3 director skill file verified on disk (prompts/skills/minimax_h3_director.md).\n');

    // 4. Test Template Interpolation
    const test_template = 'Shot duration is {{duration}}s with tempo {{bpm}} BPM. Action: {{action_intent}}. Fallback: {{missing_variable}}.';
    const interpolated_result = interpolateSkillTemplate(test_template, {
        duration: 4.5,
        bpm: 128,
        action_intent: 'Detective walks into the alley'
    });
    if (!interpolated_result.includes('4.5s with tempo 128 BPM') || !interpolated_result.includes('Fallback: N/A')) {
        throw new Error(`Interpolation failed: ${interpolated_result}`);
    }
    process.stdout.write('  ✓ Template variable slot interpolation and fallback handling verified.\n');

    // 5. Test Structured Parsing (Valid Output)
    const valid_json_model_output = JSON.stringify({
        prompt: 'Cinematic 28mm wide shot of a detective entering rain-slicked neon alley.',
        camera_movement: 'Slow tracking push-in at waist height',
        action_notes: 'Steps onto wet cobblestones, drops cigarette, shifts weight.',
        lighting_style: 'Chiaroscuro rim light with 3200K amber sodium vs deep cyan shadows.',
        subject_invariants: 'Charcoal trenchcoat with frayed cuffs, silver ring on right hand.'
    });

    const parsed_valid_record = parseStructuredStoryboardResponse(valid_json_model_output);
    if (parsed_valid_record.prompt !== 'Cinematic 28mm wide shot of a detective entering rain-slicked neon alley.') {
        throw new Error('Parsed output value mismatch.');
    }
    process.stdout.write('  ✓ Structured JSON response parsing and Zod validation verified.\n');

    // 6. Test Structured Parsing (Truncation / Invalid JSON - Settled Option B)
    const truncated_cut_off_json = '{"prompt": "Cinematic wide shot of a detective entering neon alley", "camera_movement": "Slow push';
    let did_catch_truncation_error = false;
    try {
        parseStructuredStoryboardResponse(truncated_cut_off_json);
    } catch (truncation_error) {
        did_catch_truncation_error = true;
        if (!truncation_error.message.includes('increase max_tokens in Settings')) {
            throw new Error(`Expected max_tokens recommendation in error, got: ${truncation_error.message}`);
        }
    }

    if (!did_catch_truncation_error) {
        throw new Error('Expected parseStructuredStoryboardResponse to throw on truncated JSON.');
    }
    process.stdout.write('  ✓ Truncation rejection and actionable user error notification verified (Option B).\n');

    // 7. Test Request Preparation Helpers
    const vision_request = prepareVisionDescriptionSkillRequest({
        image_role: 'Start Frame Anchor',
        action_intent: 'Subject turns head toward camera',
        shot_label: 'Shot 01'
    });
    if (!vision_request.systemPrompt.includes('Start Frame Anchor') || !vision_request.grammar.includes('prompt')) {
        throw new Error('Vision skill request payload preparation failed.');
    }

    const h3_request = prepareH3DirectorSkillRequest({
        duration: 5.0,
        bpm: 110,
        action_intent: 'High-speed motorcycle drift around corner'
    }, 'Motorcycle chase scene');
    if (!h3_request.systemPrompt.includes('5 seconds') || !h3_request.userPrompt.includes('Motorcycle chase scene')) {
        throw new Error('H3 director skill request payload preparation failed.');
    }
    process.stdout.write('  ✓ Vision & H3 request payload constructors and grammar attachment verified.\n');

    process.stdout.write('🎉 All GBNF Grammar & Skill Injection Verifications Passed Successfully!\n');
}

runGbnfSkillTests().catch((error) => {
    process.stderr.write(`❌ Test Failure: ${error?.message || error}\n`);
    process.exit(1);
});
