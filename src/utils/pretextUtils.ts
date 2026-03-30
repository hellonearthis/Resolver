import { prepare, layout } from '@chenglou/pretext';
import type { VideoClip } from '../types/assembler';

// Cache prepared text objects to avoid re-parsing the same string
const preparedCache = new Map<string, any>();

function getPreparedText(text: string, font: string) {
    const key = `${text}|${font}`;
    if (preparedCache.has(key)) {
        return preparedCache.get(key);
    }
    const prepared = prepare(text, font);
    preparedCache.set(key, prepared);
    return prepared;
}

const FONTS = {
    header: "700 11px 'Inter', sans-serif",
    label: "700 9px 'Inter', sans-serif",
    body: "400 12px 'Inter', sans-serif",
};

export function getTextHeight(text: string, width: number): number {
    if (!text) return 0;
    const prepared = getPreparedText(text, FONTS.body);
    const { height } = layout(prepared, width, 18);
    return height;
}

/**
 * Calculates the exact pixel height a StoryboardCard will require,
 * without touching the DOM, so that virtualization lists can scroll smoothly.
 * 
 * @param clip The video clip data structure
 * @param cardWidth The pixel width of the card
 */
export function calculateCardHeight(clip: VideoClip, cardWidth: number): number {
    // 1. Static Heights (Padding, Headers, Buttons, Input minimums)
    let totalHeight = 0;
    
    // Outer border/padding in card
    totalHeight += 10; // 5px padding top/bottom on card container
    
    // Header
    // px-4 py-3 = ~12px top/bottom = 24px + text (~16px) = ~40px
    totalHeight += 45; 
    
    // Previews Area (Images/Video)
    // p-4 = 32px padding vertical
    totalHeight += 32;
    // Previews have aspect-[32/9] relative to the inner width
    const innerWidth = cardWidth - 10 - 32; // card padded by 5px, previews area padded 16px sides
    const previewHeight = innerWidth * (9 / 32);
    totalHeight += previewHeight;
    
    // If there's a video selector (generated videos exist)
    if ((clip.generatedVideos && clip.generatedVideos.length > 0) || clip.videoPath) {
        totalHeight += 12; // mt-3
        if (clip.videoPath) {
            // video preview is aspect-video = 16:9
            totalHeight += innerWidth * (9 / 16);
            totalHeight += 8; // spacing below video
        }
        totalHeight += 30; // selector height + margin
    }
    
    // Content Areas padding (p-5 = 40px vertical)
    totalHeight += 40;
    
    // Spacing between elements in content area (space-y-5 = 20px gaps)
    // 4 sections: description, action, dialogue/sound, timing
    totalHeight += 20 * 3;
    
    const contentWidth = cardWidth - 10 - 40; // Card width minus card padding (10) and content padding (40)
    
    // --- 2. Dynamic Text Heights with Pretext ---
    
    // A. Image Description Box
    totalHeight += 20; // Label height + spacing
    const descText = clip.actionDescription || '';
    if (descText) {
        const height = getTextHeight(descText, contentWidth - 16);
        totalHeight += Math.max(60, height + 16); // min-h-[60px] or actual text height + padding
    } else {
        totalHeight += 60 + 16; // default min-h
    }
    
    // B. Clip Action Box
    totalHeight += 20; // Label height + spacing
    const actionText = clip.notes?.action || (clip as any).actionNotes || (clip as any).promptText || '';
    if (actionText) {
        const height = getTextHeight(actionText, contentWidth - 16);
        totalHeight += Math.max(60, height + 16);
    } else {
        totalHeight += 60 + 16;
    }
    
    // C. Dialogue & Sound Cues box (Grid 2 cols)
    totalHeight += 20; // labels
    // It's a single input block per col, standard height 30px
    totalHeight += 32; 
    
    // D. Timing Row (border-t pt-2)
    totalHeight += 9; // pt-2 + border
    totalHeight += 30; // standard 2 lines text height
    
    return totalHeight;
}
