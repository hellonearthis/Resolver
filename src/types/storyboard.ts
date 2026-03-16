/**
 * Storyboard Metadata Types
 */

export type ShotSize = 'EWS' | 'WS' | 'MS' | 'CU' | 'ECU' | string;
export type ShotAngle = 'Eye-level' | 'High Angle' | 'Low Angle' | 'Dutch Tilt' | 'OTS' | string;
export type CameraMovement = 'Static' | 'Pan' | 'Tilt' | 'Dolly' | 'Crane' | 'Handheld' | 'Zoom' | 'Steadicam' | string;
export type LocationType = 'INT' | 'EXT';

/**
 * Represents a single reusable asset in the Element Tray
 */
export interface StoryboardAsset {
    id: string;
    name: string;
    type: 'character' | 'location' | 'object';
    thumbnailUrl?: string;
    description: string;
}

/**
 * Represents a single panel in the storyboard grid
 */
export interface StoryboardCard {
    id: string;
    sceneNumber: string;
    shotLetter: string;
    actionNotes: string;
    dialogue: string;
    soundCues: string;
    imageUrl?: string;
    aiPrompt: string;
    taggedElementIds: string[]; // Relational IDs from ElementTray

    // Metadata Drawer (Production Specs)
    shotSize: ShotSize;
    shotTypeAngle: ShotAngle;
    cameraMovement: CameraMovement;
    optics: string; // e.g., "35mm"
    equipment: string;
    locationType: LocationType;
    vfxNotes: string;

    // Timeline & Animatic Data
    calculatedDuration: number; // in seconds
    paceWpm: number; // Words Per Minute for the Script Timer
}

/**
 * Pacing benchmarks for the Script Timer
 */
export const PacingBenchmarks = {
    SLOW: 110,         // 100-120 WPM
    CONVERSATIONAL: 140, // 130-150 WPM
    FAST: 170,         // 160-180 WPM
    SPEEDY: 210,       // 200+ WPM
};
