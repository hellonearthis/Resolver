/**
 * src/types/sections.ts
 * 
 * WHAT:
 *   Type definitions and theme constants for musical sections (Intro, Verse,
 *   Chorus, Bridge, Outro, Solo) in the Resolver timeline.
 * 
 * WHY:
 *   Provides structured modeling for song form analysis, allowing the Video
 *   Assembler and Storyboard to synchronize pacing, visuals, and DaVinci Resolve
 *   markers with musical narrative structure.
 */

export type SectionType = 
    | 'intro'
    | 'verse'
    | 'pre-chorus'
    | 'chorus'
    | 'bridge'
    | 'outro'
    | 'solo'
    | 'breakdown';

export interface MusicSection {
    id: string;
    name: string;
    type: SectionType;
    startTime: number;    // In seconds
    endTime: number;      // In seconds
    color: string;        // Hex or CSS color
    energyLevel?: number; // Normalized 0.0 to 1.0 intensity
}

// WHAT: Canonical color scheme matching standard DAW and Resolver dark neon aesthetics.
// WHY: Gives visual distinction between high-energy sections (Chorus = Purple/Magenta)
// and grounded narrative sections (Verse = Blue/Cyan, Intro = Green, Bridge = Amber).
export const SECTION_TYPE_COLOR_MAP: Record<SectionType, { background: string; border: string; text: string; resolveColor: string }> = {
    intro: {
        background: 'rgba(16, 185, 129, 0.2)',
        border: '#10b981',
        text: '#6ee7b7',
        resolveColor: 'Green'
    },
    verse: {
        background: 'rgba(59, 130, 246, 0.2)',
        border: '#3b82f6',
        text: '#93c5fd',
        resolveColor: 'Blue'
    },
    'pre-chorus': {
        background: 'rgba(236, 72, 153, 0.2)',
        border: '#ec4899',
        text: '#f472b6',
        resolveColor: 'Pink'
    },
    chorus: {
        background: 'rgba(168, 85, 247, 0.25)',
        border: '#a855f7',
        text: '#c084fc',
        resolveColor: 'Purple'
    },
    bridge: {
        background: 'rgba(245, 158, 11, 0.2)',
        border: '#f59e0b',
        text: '#fcd34d',
        resolveColor: 'Yellow'
    },
    breakdown: {
        background: 'rgba(239, 68, 68, 0.2)',
        border: '#ef4444',
        text: '#fca5a5',
        resolveColor: 'Red'
    },
    solo: {
        background: 'rgba(6, 182, 212, 0.2)',
        border: '#06b6d4',
        text: '#67e8f9',
        resolveColor: 'Cyan'
    },
    outro: {
        background: 'rgba(107, 114, 128, 0.2)',
        border: '#6b7280',
        text: '#d1d5db',
        resolveColor: 'Sand'
    }
};
