/**
 * Storyboard Metadata Types
 */

/** 
 * ShotSize: Industry standard framing conventions.
 * EWS: Extreme Wide Shot, WS: Wide Shot, MS: Medium Shot, 
 * CU: Close Up, ECU: Extreme Close Up.
 */
export type ShotSize = 'EWS' | 'WS' | 'MS' | 'CU' | 'ECU' | string;

/** ShotAngle: The vertical position of the camera relative to the subject. */
export type ShotAngle = 'Eye-level' | 'High Angle' | 'Low Angle' | 'Dutch Tilt' | 'OTS' | string;

/** CameraMovement: The mechanical motion of the camera during the shot. */
export type CameraMovement = 'Static' | 'Pan' | 'Tilt' | 'Dolly' | 'Crane' | 'Handheld' | 'Zoom' | 'Steadicam' | string;

/** LocationType: Cinematic location markers (Interior vs Exterior). */
export type LocationType = 'INT' | 'EXT';

/**
 * StoryboardAsset
 * 
 * Represents a reusable entity in the production universe (Element Tray).
 * These can be 'tagged' into shots to track character appearances or locations.
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
 * PacingBenchmarks for the Script Timer
 * 
 * WHY: To estimate the physical duration of a shot based on the dialogue word count.
 * HOW: We multiply the word count by these WPM constants to get a target second count.
 */
export const PacingBenchmarks = {
    SLOW: 110,         // 100-120 WPM (Dramatic, heavy pauses)
    CONVERSATIONAL: 140, // 130-150 WPM (Standard dialogue)
    FAST: 170,         // 160-180 WPM (Action, excitement)
    SPEEDY: 210,       // 200+ WPM (Rapid fire, high intensity)
};
