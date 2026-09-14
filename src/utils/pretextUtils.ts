/**
 * src/utils/pretextUtils.ts
 *
 * WHAT:
 *   Offscreen text measurement and card dimension calculator using the Pretext layout engine.
 *
 * WHY:
 *   Virtual scrolling lists (such as React Virtuoso in the Storyboard) require exact pixel
 *   heights upfront to position items accurately. Pretext computes line breaks and heights
 *   without touching the DOM, preventing Cumulative Layout Shift (CLS) and scroll jitter.
 */

import { prepare, layout } from '@chenglou/pretext';
import type { VideoClip } from '../types/assembler';

// WHAT: In-memory cache storing parsed Pretext glyph/font measurement structures.
// WHY: Avoids re-parsing the identical text and typography rules on consecutive frame renders.
type PretextPreparedTextObject = ReturnType<typeof prepare>;
const prepared_text_cache_map = new Map<string, PretextPreparedTextObject>();

// WHAT: Retrieves or computes the prepared glyph layout for a given text string and font descriptor.
// WHY: prepare() performs character analysis; caching prevents repeated work for invariant text.
function getPreparedText(target_text_content: string, font_specification_css: string): PretextPreparedTextObject {
    const cache_lookup_key = `${target_text_content}|${font_specification_css}`;
    const cached_prepared_instance = prepared_text_cache_map.get(cache_lookup_key);
    if (cached_prepared_instance) {
        return cached_prepared_instance;
    }
    const newly_prepared_instance = prepare(target_text_content, font_specification_css);
    prepared_text_cache_map.set(cache_lookup_key, newly_prepared_instance);
    return newly_prepared_instance;
}

const STORYBOARD_FONT_SPECIFICATIONS = {
    header: "700 11px 'Inter', sans-serif",
    label: "700 9px 'Inter', sans-serif",
    body: "400 12px 'Inter', sans-serif",
};

// WHAT: Measures the rendered vertical pixel height of a text block given an available column width.
// WHY: Layouts text with an 18px line height to match Tailwind's leading-relaxed body styling.
export function getTextHeight(text_content_string: string, available_column_width_pixels: number): number {
    if (!text_content_string) return 0;
    const prepared_text_instance = getPreparedText(text_content_string, STORYBOARD_FONT_SPECIFICATIONS.body);
    const layout_result = layout(prepared_text_instance, available_column_width_pixels, 18);
    return layout_result.height;
}

// WHAT: Calculates the exact total pixel height a StoryboardCard will require before DOM rendering.
// WHY: Provides deterministic item heights for the virtualized masonry grid, eliminating layout jumping.
export function calculateCardHeight(video_clip_record: VideoClip, card_bounding_width_pixels: number): number {
    // 1. Static Heights (Container padding, Header, Image/Video preview frames, Form inputs)
    const cumulative_height_components_array: number[] = [];
    
    // Outer border and container vertical padding (5px top + 5px bottom)
    cumulative_height_components_array.push(10);
    
    // Header section (px-4 py-3 = ~24px vertical padding + title text ~16px + margins)
    cumulative_height_components_array.push(45);
    
    // Dual reference image preview container (p-4 = 32px vertical padding)
    cumulative_height_components_array.push(32);
    // Reference frames render side-by-side with an aspect ratio of 32:9
    const inner_preview_width_pixels = card_bounding_width_pixels - 10 - 32;
    const dual_preview_height_pixels = inner_preview_width_pixels * (9 / 32);
    cumulative_height_components_array.push(dual_preview_height_pixels);
    
    // Video player selector area (rendered if clip has generated video versions or an assigned video path)
    const has_available_videos = (video_clip_record.generatedVideos && video_clip_record.generatedVideos.length > 0) || Boolean(video_clip_record.videoPath);
    if (has_available_videos) {
        cumulative_height_components_array.push(12); // Margin top (mt-3)
        if (video_clip_record.videoPath) {
            // Main video player frame has a standard 16:9 widescreen aspect ratio
            cumulative_height_components_array.push(inner_preview_width_pixels * (9 / 16));
            cumulative_height_components_array.push(8); // Spacing beneath video player
        }
        cumulative_height_components_array.push(30); // Video version select dropdown height
    }
    
    // Content body padding (p-5 = 40px vertical padding)
    cumulative_height_components_array.push(40);
    
    // Section vertical spacing gaps (space-y-5 = 20px gaps between 4 sections)
    cumulative_height_components_array.push(20 * 3);
    
    // Available text wrapping width inside card container
    const content_text_width_pixels = card_bounding_width_pixels - 10 - 40;
    
    // --- 2. Dynamic Text Field Heights measured with Pretext ---
    
    // Section A: AI Image Description Box
    cumulative_height_components_array.push(20); // Header label height and margin
    const image_description_text = video_clip_record.actionDescription || '';
    if (image_description_text) {
        const measured_description_height_pixels = getTextHeight(image_description_text, content_text_width_pixels - 16);
        cumulative_height_components_array.push(Math.max(60, measured_description_height_pixels + 16)); // Min height 60px or text + padding
    } else {
        cumulative_height_components_array.push(60 + 16); // Default empty min-height
    }
    
    // Section B: Director Action Notes Box
    cumulative_height_components_array.push(20); // Header label height
    const legacy_clip_access = video_clip_record as unknown as { actionNotes?: string; promptText?: string };
    const director_action_text = video_clip_record.notes?.action || legacy_clip_access.actionNotes || legacy_clip_access.promptText || '';
    if (director_action_text) {
        const measured_action_height_pixels = getTextHeight(director_action_text, content_text_width_pixels - 16);
        cumulative_height_components_array.push(Math.max(60, measured_action_height_pixels + 16));
    } else {
        cumulative_height_components_array.push(60 + 16);
    }
    
    // Section C: Dialogue and Sound Cues Grid (2 columns)
    cumulative_height_components_array.push(20); // Grid labels
    cumulative_height_components_array.push(32); // Standard single-line input height
    
    // Section D: Clip Timing and Alignment Row (border-t pt-2)
    cumulative_height_components_array.push(9);  // Border and padding top
    cumulative_height_components_array.push(30); // 2 lines of metadata text
    
    return Math.sumPrecise(cumulative_height_components_array);
}
