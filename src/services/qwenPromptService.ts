/**
 * Qwen Vision Prompt Service
 * 
 * Generates tailored vision prompt instructions for Qwen-VL based on the 
 * functional role assigned to a reference image in the storyboard.
 */

import type { ImageFunction, VideoClip } from '../types/assembler';

export interface ImageFunctionConfiguration {
    identifier: ImageFunction;
    displayName: string;
    iconEmoji: string;
    accentColor: string;
    borderClass: string;
    backgroundClass: string;
    textClass: string;
    briefExplanation: string;
}

/**
 * Registry of visual UI configurations and metadata for each supported image function.
 */
export const IMAGE_FUNCTION_REGISTRY: Record<ImageFunction, ImageFunctionConfiguration> = {
    start_frame: {
        identifier: 'start_frame',
        displayName: 'Start Frame',
        iconEmoji: '🎬',
        accentColor: '#10b981', // Emerald
        borderClass: 'border-emerald-500/40',
        backgroundClass: 'bg-emerald-500/10',
        textClass: 'text-emerald-400',
        briefExplanation: 'First frame anchor. The AI prompt develops motion forward from this opening composition.',
    },
    end_frame: {
        identifier: 'end_frame',
        displayName: 'End Frame',
        iconEmoji: '🏁',
        accentColor: '#3b82f6', // Blue
        borderClass: 'border-blue-500/40',
        backgroundClass: 'bg-blue-500/10',
        textClass: 'text-blue-400',
        briefExplanation: 'Concluding target composition. The video motion terminates at this visual arrival point.',
    },
    character_reference: {
        identifier: 'character_reference',
        displayName: 'Character Ref',
        iconEmoji: '👤',
        accentColor: '#f59e0b', // Amber
        borderClass: 'border-amber-500/40',
        backgroundClass: 'bg-amber-500/10',
        textClass: 'text-amber-400',
        briefExplanation: 'Biometric and costume lock. Enforces facial anatomy, hairstyle, and wardrobe consistency.',
    },
    scene_reference: {
        identifier: 'scene_reference',
        displayName: 'Scene Ref',
        iconEmoji: '🏛️',
        accentColor: '#06b6d4', // Cyan
        borderClass: 'border-cyan-500/40',
        backgroundClass: 'bg-cyan-500/10',
        textClass: 'text-cyan-400',
        briefExplanation: 'Environment and architecture lock. Sets lighting atmosphere, geometry, and spatial props.',
    },
    shot_style: {
        identifier: 'shot_style',
        displayName: 'Shot Style',
        iconEmoji: '🎨',
        accentColor: '#f43f5e', // Rose
        borderClass: 'border-rose-500/40',
        backgroundClass: 'bg-rose-500/10',
        textClass: 'text-rose-400',
        briefExplanation: 'Cinematography and color grade. Directs lighting key, lens optics, and aesthetic texture.',
    },
    storyboard_action: {
        identifier: 'storyboard_action',
        displayName: 'Storyboard Action',
        iconEmoji: '📐',
        accentColor: '#a855f7', // Purple
        borderClass: 'border-purple-500/40',
        backgroundClass: 'bg-purple-500/10',
        textClass: 'text-purple-400',
        briefExplanation: 'Motion blocking and choreographic vector. Interprets camera arrows and physical staging.',
    },
};

/**
 * Retrieves the display configuration for a given image function, falling back gracefully.
 * 
 * @param imageFunction The function key assigned to the image.
 * @returns The configuration containing labels, icons, and styling classes.
 */
export function getImageFunctionConfiguration(imageFunction?: ImageFunction): ImageFunctionConfiguration {
    // WHAT: Validating the presence and validity of the image function key.
    // WHY: Clips loaded from legacy project files may lack an explicit function property.
    if (imageFunction && imageFunction in IMAGE_FUNCTION_REGISTRY) {
        return IMAGE_FUNCTION_REGISTRY[imageFunction];
    }
    return IMAGE_FUNCTION_REGISTRY.start_frame;
}

/**
 * Contextual information to assist Qwen-VL when interpreting the image.
 */
export interface VisionPromptContext {
    shotLabel?: string;
    actionIntent?: string;
    dialogueOrLyrics?: string;
    targetDurationSeconds?: number;
}

/**
 * Builds specialized vision instructions for Qwen-VL based on the image's designated function.
 * 
 * @param imageFunction The semantic role assigned to the image.
 * @param context Optional narrative context from the storyboard card.
 * @returns A structured prompt instruction string to feed into Qwen-VL.
 */
export function buildQwenVisionPromptForFunction(
    imageFunction: ImageFunction,
    context?: VisionPromptContext
): string {
    // WHAT: Composing supplementary context lines if narrative information exists.
    // WHY: Giving the vision model the director's intended action helps it focus on
    // relevant somatic details instead of generic decorative background items.
    const optionalContextDirectives: string[] = [];
    if (context?.shotLabel) {
        optionalContextDirectives.push(`Shot Label: ${context.shotLabel}`);
    }
    if (context?.actionIntent) {
        optionalContextDirectives.push(`Director's Planned Action: ${context.actionIntent}`);
    }
    if (context?.dialogueOrLyrics) {
        optionalContextDirectives.push(`Dialogue / Song Lyrics: ${context.dialogueOrLyrics}`);
    }

    const formattedContextSection = optionalContextDirectives.length > 0
        ? `\n\nDIRECTOR INTENT CONTEXT:\n${optionalContextDirectives.join('\n')}`
        : '';

    // WHAT: Selecting the tailored analytical instruction based on the image role.
    // WHY: A character reference must strictly catalog facial structure and wardrobe fabrics
    // without describing the photo backdrop, whereas a scene reference must catalog
    // architectural depth and lighting without fixating on temporary background pedestrians.
    switch (imageFunction) {
        case 'start_frame':
            return (
                `You are a high-precision Computer Vision Director analyzing an image as the OPENING FIRST-FRAME ANCHOR (<Picture 1>) for the MiniMax H3 video diffusion model.${formattedContextSection}\n\n` +
                `MINIMAX H3 REFERENCE RULES:\n` +
                `MiniMax H3 treats the opening frame as the millisecond-zero physical ground truth. Everything that changes later develops directly from this composition.\n\n` +
                `ANALYTICAL INSTRUCTIONS:\n` +
                `1. Subject & Identity Anchor: Explicitly describe primary subject physical anatomy, facial features, hair length/texture, gaze line, and precise attire fabrics/colors.\n` +
                `2. Opening Camera Framing: Frame size (extreme wide, wide, medium, close-up), lens focal length feel (e.g. 24mm wide-angle vs 85mm portrait compression), camera height/angle (ground-level, eye-level, low-angle tilt), and depth of field.\n` +
                `3. Lighting & Palette: Key/fill lighting sources, color temperature (e.g. 3200K tungsten amber, daylight cyan), specular reflections, practical lights, and atmospheric density (steam, haze, grit).\n` +
                `4. Somatic Starting State: Describe the subject's immediate physical tension, muscle posture, and hand grip so subsequent action can animate smoothly without jump-cuts.\n` +
                `5. Output ONLY a clean, dense narrative description in natural English without conversational meta-commentary, greetings, or markdown headers.`
            );

        case 'end_frame':
            return (
                `You are a high-precision Computer Vision Director analyzing an image as the CONCLUDING TERMINAL FRAME (<Picture 2>) for the MiniMax H3 video diffusion model.${formattedContextSection}\n\n` +
                `MINIMAX H3 REFERENCE RULES:\n` +
                `In MiniMax H3 first-to-last frame (FL2VA) interpolation, this image defines the exact destination composition that the video motion must resolve into.\n\n` +
                `ANALYTICAL INSTRUCTIONS:\n` +
                `1. Destination Arrival Composition: Describe the final camera resting point, terminal subject position, and concluding framing.\n` +
                `2. Final Posture & Expression: Detail the subject's final resting stance, gaze termination point, and concluding emotional expression.\n` +
                `3. Positional Shifts & Props: Highlight spatial transitions, shifted objects, handheld props, or lighting evolutions from earlier action.\n` +
                `4. Output ONLY a concise, information-dense arrival specification in natural English without conversational meta-commentary or markdown headers.`
            );

        case 'character_reference':
            return (
                `You are a character supervisor analyzing an image as a CHARACTER IDENTITY REFERENCE (<Picture N> / <Subject N>) for the MiniMax H3 video model.${formattedContextSection}\n\n` +
                `MINIMAX H3 REFERENCE RULES:\n` +
                `MiniMax H3 uses this image as an invariant biometric and wardrobe lock. The video generator must preserve identity without allowing background elements or set lighting to bleed into character attire.\n\n` +
                `ANALYTICAL INSTRUCTIONS:\n` +
                `1. Biometric Invariants: Catalog facial bone structure, jawline, nose contours, eye shape/color, eyebrow arch, skin tone, hairstyle/color/texture, facial hair, and distinct marks.\n` +
                `2. Attire & Wardrobe Lock: Document garment cuts, collar styles, fabric weaves/textures (e.g. distressed leather, tailored wool, silk), exact colors, buttons, seams, and visible accessories.\n` +
                `3. EXCLUSION RULE: STRICTLY DISREGARD the photo background, studio lights, or set surroundings. Do NOT describe background scenery; describe ONLY the character's physical person and clothing.\n` +
                `4. Output ONLY an authoritative, information-dense character reference brief in natural English without conversational meta-commentary or markdown headers.`
            );

        case 'scene_reference':
            return (
                `You are a production designer analyzing an image as an ENVIRONMENT / LOCATION REFERENCE (<Picture N>) for the MiniMax H3 video model.${formattedContextSection}\n\n` +
                `MINIMAX H3 REFERENCE RULES:\n` +
                `MiniMax H3 uses this image as an environmental lock to anchor world-building materials, spatial depth, and lighting architecture across camera moves.\n\n` +
                `ANALYTICAL INSTRUCTIONS:\n` +
                `1. Spatial Geometry & Architecture: Catalog room dimensions, wall/floor materials (weathered concrete, brick, polished hardwood, wet asphalt), structural beams, pillars, doors, and windows.\n` +
                `2. Environmental Set Dressing: Important props, industrial machinery, furniture, foliage, and practical light fixtures.\n` +
                `3. Lighting & Atmospheric Tone: Ambient illumination scheme, direct light beams, color temperatures, shadows, and weather/particulates (smoke, dust motes, rain sheen).\n` +
                `4. EXCLUSION RULE: STRICTLY DISREGARD transient human subjects or temporary pedestrians unless they are permanent architectural statues.\n` +
                `5. Output ONLY an immersive environmental reference specification in natural English without conversational meta-commentary or markdown headers.`
            );

        case 'shot_style':
            return (
                `You are a Director of Photography and Colorist analyzing an image as a CINEMATOGRAPHY / SHOT STYLE REFERENCE (<Picture N>) for the MiniMax H3 video model.${formattedContextSection}\n\n` +
                `MINIMAX H3 REFERENCE RULES:\n` +
                `MiniMax H3 extracts aesthetic directives from style references, including lighting contrast ratio, color grading palette, and optical characteristics, applying them globally.\n\n` +
                `ANALYTICAL INSTRUCTIONS:\n` +
                `1. Lighting Architecture: Key-to-fill ratio, lighting key (e.g. high-key, chiaroscuro, harsh rim lighting, diffuse overcast), shadow softness, and specular highlight rolloff.\n` +
                `2. Color Palette & Grade: Dominant hue contrasts (e.g. warm amber tungsten paired with deep cyan shadows, muted monochrome, pastel mustard), saturation levels, and tint.\n` +
                `3. Lens & Optical Physics: Focal length aesthetic (wide-angle distortion vs telephoto compression), depth of field, bokeh characteristics, lens breathing, and analog film/sensor grain.\n` +
                `4. Output ONLY a focused cinematographic style directive in natural English without conversational meta-commentary or markdown headers.`
            );

        case 'storyboard_action':
            return (
                `You are a stunt coordinator and animation director analyzing an image as a STORYBOARD ACTION / MOTION BLOCKING SKETCH (<Picture N>) for the MiniMax H3 video model.${formattedContextSection}\n\n` +
                `MINIMAX H3 REFERENCE RULES:\n` +
                `MiniMax H3 requires dynamic actions to be framed as single dominant physical vectors chained by cause-and-effect triggers.\n\n` +
                `ANALYTICAL INSTRUCTIONS:\n` +
                `1. Kinetic Vectors & Blocking: Interpret subject motion direction, velocity, and force (e.g. rapid sprint screen-left to screen-right, abrupt bodily turn, sudden duck).\n` +
                `2. Drawn Storyboard Symbols: Translate drawn motion arrows, speed lines, camera framing brackets, and field-of-view indicators into descriptive physical kinematics.\n` +
                `3. Camera Dynamic Path: Identify implied camera maneuvers (pan, push, pedestal, track) that match the sketched action.\n` +
                `4. Output ONLY a dynamic choreographic motion brief in natural English without conversational meta-commentary or markdown headers.`
            );

        default:
            return (
                `Analyze this image in detail for a MiniMax H3 cinematic video generation prompt. Describe the primary subject identity, composition framing, lighting architecture, environment, and physical motion clearly and concisely without conversational meta-commentary or markdown headers.`
            );
    }
}

/**
 * Options for tailoring the MiniMax H3 multimodal director brief prompt.
 */
export interface MiniMaxH3SystemPromptOptions {
    isDualReference: boolean;
    startRole?: ImageFunction;
    endRole?: ImageFunction;
}

// WHAT: Generates comprehensive director & technical producer system instructions for MiniMax H3.
// WHY: MiniMax H3 is a unified multimodal diffusion model that processes text, image, and audio in a single pass.
// Structuring prompts as director's paperwork with explicit invariance contracts, event-driven micro-beats,
// and prohibition of clock timecodes drastically improves physical stability and prevents character morphing.
export function buildMiniMaxH3SystemPrompt(options: MiniMaxH3SystemPromptOptions): string {
    const start_configuration = getImageFunctionConfiguration(options.startRole || 'start_frame');
    const end_configuration = getImageFunctionConfiguration(options.endRole || 'end_frame');

    const mode_instruction = options.isDualReference
        ? `OPERATING MODE: Reference-to-Video (R2V) with Dual Reference Images.\n` +
          `- Image 1 (<Picture 1>) assigned role: ${start_configuration.displayName} (${start_configuration.briefExplanation})\n` +
          `- Image 2 (<Picture 2>) assigned role: ${end_configuration.displayName} (${end_configuration.briefExplanation})\n\n` +
          `REFERENCE ASSIGNMENT RULES:\n` +
          `1. Explicitly declare how Image 1 and Image 2 inform the scene in the Reference Locks clause.\n` +
          `2. If an image is a Character Ref, lock facial bone structure, hairstyle, eye color, and wardrobe fabric. Prevent character identity drift or facial warping.\n` +
          `3. If an image is a Scene Ref, lock architectural geometry, spatial set design, environmental lighting, and materials.\n` +
          `4. If an image is a Start Frame, anchor the opening millisecond-zero visual frame to this exact image.\n` +
          `5. If an image is an End Frame, ensure video motion smoothly concludes at this target pose and framing.\n` +
          `6. If an image is a Shot Style, replicate the lighting key, color grading, contrast ratio, and lens optics.\n` +
          `7. If an image is a Storyboard Action, follow the motion vectors and blocking indicated.`
        : `OPERATING MODE: Image-to-Video (I2VA) with Single Reference Image.\n` +
          `- Image 1 (<Picture 1>) assigned role: ${start_configuration.displayName} (${start_configuration.briefExplanation})\n\n` +
          `REFERENCE ASSIGNMENT RULES:\n` +
          `1. Anchor the opening composition, subject posture, lighting, and palette from Image 1.\n` +
          `2. Develop continuous somatic motion forward from this opening visual state.`;

    return (
        `You are an expert Film Director and Technical Producer writing production briefs for the MiniMax H3 multimodal video generation model.\n\n` +
        `${mode_instruction}\n\n` +
        `REQUIRED OUTPUT SECTIONS:\n` +
        `Every production brief must follow this structured format:\n\n` +
        `[Header & Invariance Contract]\n` +
        `Duration: <duration> seconds\n` +
        `Aspect Ratio: 16:9\n` +
        `Frame Rate: <fps> fps\n` +
        `Reference Locks: <Explicit invariant lock statements for Image 1 and Image 2>\n\n` +
        `[Action & Cinematography]\n` +
        `<One dominant physical action described in natural cinematographic language. Chain micro-beats sequentially using physical cause-and-effect triggers rather than clock times. Include camera path, framing, lens optics, and lighting key.>\n\n` +
        `[Dialogue & Soundscape]\n` +
        `Dialogue: <Character (S1) speaks with [vocal texture/delivery] and says: "exact quoted words", or 'N/A' if silent>\n` +
        `Soundscape: <Ambient room tone, environmental textures, and physical contact foley>\n` +
        `Non-Diegetic Music: <Audience-facing score, instrumentation, tempo, or 'N/A'>\n\n` +
        `[Negative Guardrails]\n` +
        `<Explicit prohibitions preventing morphing between characters, face distortion, rubbery anatomy, extra limbs, background bleeding, or digital high-pass halos.>\n\n` +
        `CRITICAL TECHNICAL CONSTRAINTS:\n` +
        `1. 🚫 NO 'AT' OR 'FROM' ABSOLUTE CLOCK TIMECODES: Do NOT use absolute clock time references such as 'At 00:10:00', 'From 00:12:00', or 'At 00:08.000'. MiniMax H3's video diffusion transformer lacks an internal sub-second clock; absolute 'At' / 'From' timestamps cause severe temporal drift or premature cuts. Instead, chain micro-beats sequentially using event-driven cause-and-effect physical triggers ('In the opening moment...', 'Midway through the take...', 'Upon reaching the mark...', 'As the subject turns...'). Standard bracketed range markers (e.g. '[00:00 - 00:05]') are acceptable for sound mix/shot headers, but never use 'At' or 'From' in action descriptions.\n` +
        `2. 🚫 NO <d> TAGS FOR DIALOGUE: MiniMax H3 natively processes standard double quotes. ALWAYS format dialogue as: (S1) says: "exact spoken words". Never use <d>...</d> tags as they cause tokenization failure.\n` +
        `3. 🚫 NO BRACKETED CAMERA SYNTAX: Write fluent natural cinematographic sentences (e.g. 'The camera slowly pushes in on an eye-level 35mm lens...'). Never use bracketed parameters like [Camera: Push in 2s].\n` +
        `4. Single Dominant Action: Focus on ONE continuous physical action or motion vector to prevent spatial warping.\n` +
        `5. Output ONLY the production brief text. Do not add introductory conversational filler, greetings, or markdown code fences.`
    );
}

// WHAT: Builds the user input block for LLM expansion from storyboard clip metadata.
// WHY: Packages reference descriptions, director notes, dialogue, and camera optics into a clean prompt.
export function buildMiniMaxH3UserPrompt(clip: VideoClip, project_frame_rate: number = 24): string {
    const prompt_sections_list: string[] = [];
    const start_configuration = getImageFunctionConfiguration(clip.startImageFunction || 'start_frame');
    const end_configuration = getImageFunctionConfiguration(clip.endImageFunction || 'end_frame');

    const first_image_description = clip.actionDescription || clip.startImageDescription;
    if (first_image_description) {
        prompt_sections_list.push(`Image 1 (${start_configuration.displayName}):\n${first_image_description}`);
    }

    if (clip.endImageDescription) {
        prompt_sections_list.push(`Image 2 (${end_configuration.displayName}):\n${clip.endImageDescription}`);
    }

    if (clip.notes?.action) {
        prompt_sections_list.push(`Director's Action Directive:\n${clip.notes.action}`);
    }

    if (clip.notes?.dialogue) {
        prompt_sections_list.push(`Dialogue / Song Lyrics:\n${clip.notes.dialogue}`);
    }

    if (clip.notes?.sound) {
        prompt_sections_list.push(`Sound / Foley Notes:\n${clip.notes.sound}`);
    }

    // Cinematographic optical directives if specified
    const cinematographic_metadata_items: string[] = [];
    if (clip.shotSize) cinematographic_metadata_items.push(`Framing: ${clip.shotSize}`);
    if (clip.shotTypeAngle) cinematographic_metadata_items.push(`Angle: ${clip.shotTypeAngle}`);
    if (clip.cameraMovement) cinematographic_metadata_items.push(`Movement: ${clip.cameraMovement}`);
    if (clip.optics) cinematographic_metadata_items.push(`Optics/Lens: ${clip.optics}`);
    if (clip.locationType) cinematographic_metadata_items.push(`Location Type: ${clip.locationType}`);
    if (clip.vfxNotes) cinematographic_metadata_items.push(`VFX Notes: ${clip.vfxNotes}`);

    if (cinematographic_metadata_items.length > 0) {
        prompt_sections_list.push(`Camera & Visual Direction:\n${cinematographic_metadata_items.join(', ')}`);
    }

    const duration_seconds_value = clip.duration || 3.0;
    prompt_sections_list.push(`Target Duration: ${duration_seconds_value.toFixed(2)} seconds (${Math.round(duration_seconds_value * project_frame_rate)} frames at ${project_frame_rate} fps)`);

    return prompt_sections_list.join('\n\n');
}

// WHAT: Constructs a structured MiniMax H3 prompt directly from clip metadata when no LLM expansion is present.
// WHY: Ensures direct video generation adhering to MiniMax H3 standards even without an external LLM call.
export function buildMiniMaxH3DirectBrief(clip: VideoClip, project_frame_rate: number = 24): string {
    const start_configuration = getImageFunctionConfiguration(clip.startImageFunction || 'start_frame');
    const end_configuration = getImageFunctionConfiguration(clip.endImageFunction || 'end_frame');
    const duration_seconds_value = clip.duration || 3.0;
    const has_dual_reference = Boolean(clip.startImagePath && clip.endImagePath);

    const first_image_description = clip.actionDescription || clip.startImageDescription || '';
    const second_image_description = clip.endImageDescription || '';
    const action_directive_text = clip.notes?.action || clip.label || 'Cinematic action shot';
    const dialogue_text = clip.notes?.dialogue?.trim() || '';
    const sound_text = clip.notes?.sound?.trim() || '';

    const brief_sections_list: string[] = [];

    // Header & Invariance Contract
    const header_lines_list: string[] = [
        `[Header & Invariance Contract]`,
        `Duration: ${duration_seconds_value.toFixed(1)} seconds`,
        `Aspect Ratio: 16:9`,
        `Frame Rate: ${project_frame_rate} fps`,
    ];

    if (has_dual_reference) {
        header_lines_list.push(
            `Reference Locks: Image 1 (${start_configuration.displayName}) establishes opening character/setting context: ${first_image_description || 'primary reference'}. Image 2 (${end_configuration.displayName}) establishes target arrival/style reference: ${second_image_description || 'secondary reference'}.`
        );
    } else if (first_image_description) {
        header_lines_list.push(
            `Reference Lock: Image 1 (${start_configuration.displayName}) anchors opening framing: ${first_image_description}.`
        );
    }
    brief_sections_list.push(header_lines_list.join('\n'));

    // Action & Cinematography
    const action_lines_list: string[] = [
        `[Action & Cinematography]`,
        `In the opening moments, ${action_directive_text}`,
    ];
    if (clip.cameraMovement || clip.shotSize) {
        action_lines_list.push(`Camera movement: ${clip.cameraMovement || 'steady tracking'} on a ${clip.shotSize || 'medium'} composition with natural focal depth.`);
    }
    brief_sections_list.push(action_lines_list.join('\n'));

    // Dialogue & Soundscape
    const sound_lines_list: string[] = [`[Dialogue & Soundscape]`];
    if (dialogue_text) {
        sound_lines_list.push(`Dialogue: The character speaks with natural clarity and says, "${dialogue_text}"`);
    } else {
        sound_lines_list.push(`Dialogue: N/A`);
    }
    sound_lines_list.push(`Soundscape: ${sound_text || 'Ambient environmental room tone and natural physical motion sound'}`);
    sound_lines_list.push(`Non-Diegetic Music: N/A`);
    brief_sections_list.push(sound_lines_list.join('\n'));

    // Negative Guardrails
    brief_sections_list.push(
        `[Negative Guardrails]\n` +
        `No facial morphing or identity blurring. No rubbery motion or impossible joint bending. Maintain stable facial bone structure matching Image 1. No digital high-pass edge halos.`
    );

    return brief_sections_list.join('\n\n');
}
