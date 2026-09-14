/**
 * src/services/llmSkillService.ts
 * 
 * WHAT:
 *   Skill Template and GBNF Grammar Orchestration Service for Resolver.
 *   Provides template variable interpolation, GBNF grammar loading, and strict
 *   JSON output validation for local llama.cpp / llama-server generation tasks.
 * 
 * WHY:
 *   Forces local models (e.g. Qwen 3.5, MiniMax H3 prompters) to return 100% syntactically
 *   valid, strongly-typed JSON conforming directly to Resolver's storyboard card model,
 *   eliminating regex hacks, markdown fence stripping, and JSON parsing crashes.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Type Definitions & Zod Schemas
// ---------------------------------------------------------------------------

// WHAT: Zod schema enforcing the 5-key Storyboard card structured contract.
// WHY: Ensures model responses strictly contain all expected fields with valid types.
export const StoryboardClipStructuredSchema = z.object({
    prompt: z.string().describe('Master cinematic visual prompt text.'),
    camera_movement: z.string().describe('Camera trajectory, lens feel, and elevation.'),
    action_notes: z.string().describe('Subject kinematics and somatic micro-beats.'),
    lighting_style: z.string().describe('Key-to-fill ratio, color temperature, and atmospheric light.'),
    subject_invariants: z.string().describe('Biometric, wardrobe, or architectural identity locks.')
});

export type StoryboardClipStructuredOutput = z.infer<typeof StoryboardClipStructuredSchema>;

export interface VisionSkillContextVariables {
    image_role: string;
    action_intent?: string;
    dialogue_or_lyrics?: string;
    shot_label?: string;
}

export interface H3DirectorSkillContextVariables {
    duration?: number | string;
    bpm?: number | string;
    action_intent?: string;
    camera_direction?: string;
    style_reference?: string;
    previous_clip_context?: string;
}

// ---------------------------------------------------------------------------
// Embedded Default Templates (Zero-IO Fallback)
// ---------------------------------------------------------------------------

// WHAT: Embedded default GBNF grammar for storyboard clip JSON generation.
// WHY: Ensures grammar enforcement functions reliably even in sandboxed or packaged builds.
export const DEFAULT_STORYBOARD_CLIP_GBNF_GRAMMAR = `
root ::= "{" ws "\\"prompt\\":" ws string "," ws "\\"camera_movement\\":" ws string "," ws "\\"action_notes\\":" ws string "," ws "\\"lighting_style\\":" ws string "," ws "\\"subject_invariants\\":" ws string ws "}"
string ::= "\\"" char* "\\""
char ::= [^"\\\\\\x7F\\x00-\\x1F] | "\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F])
ws ::= [ \\t\\n\\r]*
`.trim();

// WHAT: Embedded default vision analysis skill template.
export const DEFAULT_IMAGE_DESCRIPTION_SKILL_TEMPLATE = `
# ROLE & MISSION: Computer Vision Director & Asset Auditor (Qwen-VL)

You are an expert Computer Vision Director, Technical Cinematographer, and Visual Asset Auditor analyzing storyboard imagery to anchor AI video diffusion generation (specifically MiniMax H3 and modern diffusion architectures).

Your mission is to perform rigorous, sensory, somatic, and architectural image analysis based on the assigned functional role of the image.

## CONTEXT DIRECTIVES:
- Functional Image Role: {{image_role}}
- Planned Director Action: {{action_intent}}
- Dialogue / Musical Lyrics: {{dialogue_or_lyrics}}
- Shot Identifier: {{shot_label}}

## ROLE-SPECIFIC ANALYSIS RULES:
- Start Frame: Opening millisecond-zero ground truth. Detail anatomy, muscle tension, lens, and lighting.
- End Frame: Concluding terminal frame that motion must resolve into.
- Character Ref: Biometric and wardrobe lock. Strictly disregard background scenery.
- Scene Ref: Environmental architectural lock. Catalog surfaces, dimensions, and atmospheric density.
- Shot Style: Lighting key, contrast, color temperature, and lens optics (anamorphic, polarizing CPL, ND, macro, 35mm film stock).
- Storyboard Action: Kinematic motion vectors and camera blocking.

## STRUCTURED OUTPUT REQUIREMENTS:
Output MUST be a JSON object with keys: prompt, camera_movement, action_notes, lighting_style, subject_invariants.
`.trim();

// WHAT: Embedded default MiniMax H3 director skill template.
export const DEFAULT_MINIMAX_H3_DIRECTOR_SKILL_TEMPLATE = `
# ROLE & MISSION: Master Cinematic AI Director (MiniMax H3 / Storyboard Engine)

You are an elite Hollywood Director of Photography, Psychological Staging Architect, and AI Cinematographer specializing in prompt synthesis for the MiniMax H3 video diffusion engine.

Your objective is to translate storyboard card parameters into a visually stunning, information-dense, physically continuous cinematic prompt and typed metadata. You unify camera optics, subject kinetics, psychological tension, and native sound design without glitches, morphing, or jump cuts.

## PRODUCTION CONTEXT (INJECTED METADATA):
- Shot Duration: {{duration}} seconds
- Timeline Tempo: {{bpm}} BPM
- Planned Director Action: {{action_intent}}
- Camera Direction: {{camera_direction}}
- Style & Aesthetic Reference: {{style_reference}}
- Previous Shot Continuity Context: {{previous_clip_context}}

## MINIMAX H3 CORE DIRECTING LAWS:
1. 6-Layer Formula: [MM:SS.mmm–MM:SS.mmm] Subject + Action + Scene + Visual/Lens Style + Camera Movement + Audio.
2. Single Dominant Action: Limit shot to ONE primary physical action to prevent diffusion collapse or morphing.
3. One-Move Camera Law: Assign strictly ONE camera behavior per shot coupled with focal length optics.
4. Optical Glass & Filter Simulation: Anamorphic oval flares/bokeh, CPL glare reduction, ND motion smoothing, macro texture, 35mm grain.
5. Psychological Design & Somatic Micro-Tells: Somatic tells (clenched jaw, rapid saccades, glottal swallow) and cognitive latency holds.
6. Event-Driven Progression: Never use intra-shot clock timestamps ('at 00:03' / 'from 00:04'); use event transitions ('As subject turns...', 'Midway through take...').
7. Native Audio: Diegetic foley and room tone with standard double quotes for dialogue.

## STRUCTURED OUTPUT REQUIREMENTS:
Output MUST be a JSON object with keys: prompt, camera_movement, action_notes, lighting_style, subject_invariants.
`.trim();

// ---------------------------------------------------------------------------
// Template Interpolation & Parsing Helpers
// ---------------------------------------------------------------------------

// WHAT: Replaces {{variable_name}} tokens in a markdown skill template with contextual values.
// WHY: Injects card and project metadata into the prompt without requiring external heavy libraries.
export function interpolateSkillTemplate(
    raw_template_content_string: string,
    context_variables_record: Record<string, unknown>
): string {
    return raw_template_content_string.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_match_token, variable_name_string) => {
        const resolved_variable_value = context_variables_record[variable_name_string];
        if (resolved_variable_value === undefined || resolved_variable_value === null) {
            return 'N/A';
        }
        return String(resolved_variable_value);
    });
}

// WHAT: Parses and strictly validates a raw LLM text response against the Storyboard output schema.
// WHY: Implements our settled Option B: Throws an actionable error if the response is cut off or invalid.
export function parseStructuredStoryboardResponse(raw_model_response_string: string): StoryboardClipStructuredOutput {
    const trimmed_response_string = String(raw_model_response_string || '').trim();

    if (!trimmed_response_string) {
        throw new Error('LLM returned an empty response. Verify model status and context size.');
    }

    let parsed_json_payload: unknown;
    try {
        parsed_json_payload = JSON.parse(trimmed_response_string);
    } catch (json_syntax_parse_error) {
        const syntax_error_message = json_syntax_parse_error instanceof Error 
            ? json_syntax_parse_error.message 
            : String(json_syntax_parse_error);

        throw new Error(
            `Structured output parsing failed: The response was not valid JSON (${syntax_error_message}). ` +
            `This typically indicates the model ran out of tokens before completing the GBNF grammar. ` +
            `Please increase max_tokens in Settings or simplify the scene context.`
        );
    }

    // Validate structure using Zod
    const schema_validation_result = StoryboardClipStructuredSchema.safeParse(parsed_json_payload);
    if (!schema_validation_result.success) {
        const formatted_validation_issues = schema_validation_result.error.issues
            .map((issue_item) => `${issue_item.path.join('.')}: ${issue_item.message}`)
            .join('; ');

        throw new Error(
            `Structured output schema mismatch: ${formatted_validation_issues}. ` +
            `The output did not contain all required fields.`
        );
    }

    return schema_validation_result.data;
}

// ---------------------------------------------------------------------------
// Skill Preparation Functions
// ---------------------------------------------------------------------------

// WHAT: Loads a skill template from disk if running in Electron/Node environment, falling back to embedded string.
// WHY: Allows the user to live-edit prompts/skills/*.md on disk and have changes reflected immediately without rebuilding.
export function loadSkillTemplateFromDisk(skill_identifier: 'image_description_qwen' | 'minimax_h3_director'): string {
    try {
        const node_fs = typeof window !== 'undefined' && window.require ? window.require('fs') : null;
        const node_path = typeof window !== 'undefined' && window.require ? window.require('path') : null;
        if (node_fs && node_path) {
            const disk_skill_file_path = node_path.resolve(process.cwd(), 'prompts', 'skills', `${skill_identifier}.md`);
            if (node_fs.existsSync(disk_skill_file_path)) {
                return node_fs.readFileSync(disk_skill_file_path, 'utf8');
            }
        }
    } catch {
        // Fallback to embedded default template
    }
    return skill_identifier === 'image_description_qwen'
        ? DEFAULT_IMAGE_DESCRIPTION_SKILL_TEMPLATE
        : DEFAULT_MINIMAX_H3_DIRECTOR_SKILL_TEMPLATE;
}

// WHAT: Assembles system and user prompts for Vision Description analysis with GBNF grammar.
// WHY: Gives the caller a ready-to-dispatch payload for llama-server.
export function prepareVisionDescriptionSkillRequest(
    context_variables: VisionSkillContextVariables,
    custom_template_override_string?: string
): {
    systemPrompt: string;
    userPrompt: string;
    grammar: string;
} {
    const active_template_string = custom_template_override_string || loadSkillTemplateFromDisk('image_description_qwen');
    const hydrated_system_prompt_string = interpolateSkillTemplate(
        active_template_string,
        context_variables as unknown as Record<string, unknown>
    );

    const user_prompt_string = `Analyze the provided reference image acting in the role of "${context_variables.image_role}". Output the structured JSON specification.`;

    return {
        systemPrompt: hydrated_system_prompt_string,
        userPrompt: user_prompt_string,
        grammar: DEFAULT_STORYBOARD_CLIP_GBNF_GRAMMAR
    };
}

// WHAT: Assembles system and user prompts for MiniMax H3 Prompt Generation with GBNF grammar.
// WHY: Ensures prompt expansion follows the 5-block cinematic methodology with strict JSON output.
export function prepareH3DirectorSkillRequest(
    context_variables: H3DirectorSkillContextVariables,
    scene_seed_prompt_string: string,
    custom_template_override_string?: string
): {
    systemPrompt: string;
    userPrompt: string;
    grammar: string;
} {
    const active_template_string = custom_template_override_string || loadSkillTemplateFromDisk('minimax_h3_director');
    const hydrated_system_prompt_string = interpolateSkillTemplate(
        active_template_string,
        context_variables as unknown as Record<string, unknown>
    );

    const user_prompt_string = `Expand this scene into a cinematic MiniMax H3 prompt: "${scene_seed_prompt_string}". Output the structured JSON specification.`;

    return {
        systemPrompt: hydrated_system_prompt_string,
        userPrompt: user_prompt_string,
        grammar: DEFAULT_STORYBOARD_CLIP_GBNF_GRAMMAR
    };
}
