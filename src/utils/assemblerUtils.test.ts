/**
 * src/utils/assemblerUtils.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
    extractMainMarkersFromProject,
    buildResolveExportMarkers,
    buildResolveSectionMarkers,
    createClipFromSelection,
    updateClipStartTime,
    updateClipEndTimeWithRipple,
    parseSrtSubtitlesToClips,
    calculateMarkerLegendCounts
} from './assemblerUtils';
import { MARKER_COLORS } from './timelineUtils';
import type { ProjectMarker } from '../hooks/useProjectStorage';
import type { MusicSection } from '../types/sections';
import type { VideoClip, SelectionState, AudioMarker, StemData } from '../types/assembler';

describe('assemblerUtils', () => {
    describe('extractMainMarkersFromProject', () => {
        it('returns an empty array when given undefined or empty project markers', () => {
            expect(extractMainMarkersFromProject(undefined)).toEqual([]);
            expect(extractMainMarkersFromProject([])).toEqual([]);
        });

        it('filters out stem markers while retaining main track markers', () => {
            const markers: ProjectMarker[] = [
                { timestamp: 0.5, type: 'beat', note: 'downbeat' },
                { timestamp: 1.0, type: 'beat', note: 'drums' },
                { timestamp: 1.5, type: 'beat', note: 'bass' },
                { timestamp: 2.0, type: 'beat', note: 'grid' },
                { timestamp: 2.5, type: 'onset', note: '' }
            ];

            const result = extractMainMarkersFromProject(markers);
            expect(result).toHaveLength(3);
            expect(result.map(marker_item => marker_item.time)).toEqual([0.5, 2.0, 2.5]);
            expect(result[0].isDownbeat).toBe(true);
            expect(result[1].isDownbeat).toBe(false);
        });

        it('identifies downbeats by downbeat color', () => {
            const markers: ProjectMarker[] = [
                { timestamp: 1.0, type: 'beat', color: MARKER_COLORS.downbeat }
            ];
            const result = extractMainMarkersFromProject(markers);
            expect(result[0].isDownbeat).toBe(true);
            expect(result[0].color).toBe(MARKER_COLORS.downbeat);
        });
    });

    describe('buildResolveExportMarkers', () => {
        it('converts main markers and stem markers into Resolve format with calculated frames', () => {
            const mainMarkers: AudioMarker[] = [
                { time: 1.0, type: 'beat', isDownbeat: true, color: '#ff0000' },
                { time: 2.0, type: 'beat', isDownbeat: false, color: '#ffff00' }
            ];
            const stems: StemData[] = [
                {
                    type: 'drums',
                    url: 'blob:drums',
                    path: 'drums.wav',
                    color: '#ef4444',
                    markers: [{ time: 1.5, type: 'onset' }]
                }
            ];

            const result = buildResolveExportMarkers(mainMarkers, stems, 24);
            expect(result).toHaveLength(3);

            // First main marker (1.0s @ 24fps = 24 frame)
            expect(result[0]).toEqual({
                time: 1.0,
                timestamp: 1.0,
                frame: 24,
                type: 'beat',
                color: '#ff0000',
                note: 'DOWNBEAT',
                duration_sec: 0.05
            });

            // Second main marker (2.0s @ 24fps = 48 frame)
            expect(result[1]).toEqual({
                time: 2.0,
                timestamp: 2.0,
                frame: 48,
                type: 'beat',
                color: '#ffff00',
                note: 'BEAT',
                duration_sec: 0.05
            });

            // Stem marker (1.5s @ 24fps = 36 frame)
            expect(result[2]).toEqual({
                time: 1.5,
                timestamp: 1.5,
                frame: 36,
                type: 'onset',
                color: '#ef4444',
                note: 'DRUMS: onset',
                duration_sec: 0.05
            });
        });
    });

    describe('buildResolveSectionMarkers', () => {
        it('formats sections into chapter markers with correct resolve colors', () => {
            const sections: MusicSection[] = [
                { id: '1', name: 'Intro', type: 'intro', startTime: 0, endTime: 10 },
                { id: '2', name: 'Breakdown 1', type: 'breakdown', startTime: 10, endTime: 25 }
            ];

            const result = buildResolveSectionMarkers(sections, 30);
            expect(result).toHaveLength(2);

            expect(result[0].frame).toBe(0);
            expect(result[0].duration_sec).toBe(10);
            expect(result[0].type).toBe('chapter');
            expect(result[0].note).toBe('Intro (INTRO)');
            expect(result[0].color).toBe('Green');

            expect(result[1].frame).toBe(300); // 10s * 30fps
            expect(result[1].duration_sec).toBe(15);
            expect(result[1].color).toBe('Red');
        });
    });

    describe('createClipFromSelection', () => {
        it('creates a clip snapped to MiniMax aligned frame duration', () => {
            const selection: SelectionState = {
                source: 'stem',
                stemIndex: 0,
                start: 5.0,
                end: 7.0
            };
            const stems: StemData[] = [
                { type: 'vocals', url: '', path: '', color: '', markers: [] }
            ];

            const clip = createClipFromSelection({
                selection,
                stems,
                existingClipsCount: 2,
                frameRate: 20
            });

            expect(clip.startTime).toBe(5.0);
            expect(clip.duration).toBeGreaterThan(0);
            expect(clip.endTime).toBeCloseTo(clip.startTime + clip.duration);
            expect(clip.track).toBe(1); // (2 % 2) + 1
            expect(clip.stemName).toBe('vocals');
            expect(clip.status).toBe('pending');
            expect(clip.label).toBe('clip_2');
        });
    });

    describe('updateClipStartTime', () => {
        it('updates start and end times preserving exact duration', () => {
            const clips: VideoClip[] = [
                {
                    id: 'clip-1',
                    startTime: 2.0,
                    endTime: 5.0,
                    duration: 3.0,
                    track: 1,
                    status: 'pending',
                    source: 'main',
                    label: 'Clip 1'
                },
                {
                    id: 'clip-2',
                    startTime: 5.0,
                    endTime: 8.0,
                    duration: 3.0,
                    track: 2,
                    status: 'pending',
                    source: 'main',
                    label: 'Clip 2'
                }
            ];

            const updated = updateClipStartTime(clips, 'clip-1', 4.0);
            expect(updated[0].startTime).toBe(4.0);
            expect(updated[0].endTime).toBe(7.0);
            expect(updated[0].duration).toBe(3.0);
            // clip-2 should remain untouched
            expect(updated[1].startTime).toBe(5.0);
        });
    });

    describe('updateClipEndTimeWithRipple', () => {
        it('resizes target clip and ripples subsequent clips sequentially', () => {
            const clips: VideoClip[] = [
                {
                    id: 'clip-1',
                    startTime: 0.0,
                    endTime: 2.0,
                    duration: 2.0,
                    track: 1,
                    status: 'pending',
                    source: 'main',
                    label: 'Clip 1'
                },
                {
                    id: 'clip-2',
                    startTime: 2.0,
                    endTime: 5.0,
                    duration: 3.0,
                    track: 2,
                    status: 'pending',
                    source: 'main',
                    label: 'Clip 2'
                }
            ];

            // Extend clip-1 to ~4s (at 20fps aligned duration)
            const updated = updateClipEndTimeWithRipple(clips, 'clip-1', 4.0, 20);

            // clip-1 duration should be updated
            expect(updated[0].startTime).toBe(0.0);
            expect(updated[0].endTime).toBeGreaterThan(3.5);

            // clip-2 should have been rippled to start exactly at clip-1's new endTime
            expect(updated[1].startTime).toBe(updated[0].endTime);
            expect(updated[1].endTime).toBe(updated[0].endTime + updated[1].duration);
        });

        it('returns unchanged clips if target clip is not found or newEndTime <= startTime', () => {
            const clips: VideoClip[] = [
                {
                    id: 'clip-1',
                    startTime: 5.0,
                    endTime: 8.0,
                    duration: 3.0,
                    track: 1,
                    status: 'pending',
                    source: 'main',
                    label: 'Clip 1'
                }
            ];

            expect(updateClipEndTimeWithRipple(clips, 'missing-id', 10.0)).toEqual(clips);
            expect(updateClipEndTimeWithRipple(clips, 'clip-1', 4.0)).toEqual(clips); // 4 <= 5
        });
    });

    describe('parseSrtSubtitlesToClips', () => {
        it('returns empty array on empty input', () => {
            expect(parseSrtSubtitlesToClips('')).toEqual([]);
            expect(parseSrtSubtitlesToClips('   \n  ')).toEqual([]);
        });

        it('parses standard SRT format with multiple cues and alternating tracks', () => {
            const srtContent = `
1
00:00:01,000 --> 00:00:04,500
Hello world, welcome to the show!

2
00:00:05,200 --> 00:00:08,000
Second subtitle line here.
            `.trim();

            const clips = parseSrtSubtitlesToClips(srtContent);
            expect(clips).toHaveLength(2);

            expect(clips[0].startTime).toBe(1.0);
            expect(clips[0].endTime).toBe(4.5);
            expect(clips[0].duration).toBe(3.5);
            expect(clips[0].track).toBe(1);
            expect(clips[0].notes?.action).toBe('Hello world, welcome to the show!');

            expect(clips[1].startTime).toBe(5.2);
            expect(clips[1].endTime).toBe(8.0);
            expect(clips[1].duration).toBeCloseTo(2.8);
            expect(clips[1].track).toBe(2);
            expect(clips[1].notes?.action).toBe('Second subtitle line here.');
        });

        it('handles WebVTT period separator format', () => {
            const vttContent = `
00:01:10.500 --> 00:01:15.000
Line from WebVTT
            `.trim();

            const clips = parseSrtSubtitlesToClips(vttContent);
            expect(clips).toHaveLength(1);
            expect(clips[0].startTime).toBe(70.5);
            expect(clips[0].endTime).toBe(75.0);
        });
    });

    describe('calculateMarkerLegendCounts', () => {
        it('tallies counts across main track and stems according to predicate', () => {
            const mainMarkers: AudioMarker[] = [
                { time: 1.0, type: 'beat', isDownbeat: true },
                { time: 2.0, type: 'beat', isDownbeat: false },
                { time: 3.0, type: 'onset' }
            ];
            const stems: StemData[] = [
                {
                    type: 'drums',
                    url: '',
                    path: '',
                    color: '#ef4444',
                    markers: [
                        { time: 1.0, type: 'beat', isDownbeat: true },
                        { time: 2.5, type: 'beat', isDownbeat: true }
                    ]
                },
                {
                    type: 'bass',
                    url: '',
                    path: '',
                    color: '#f59e0b',
                    markers: []
                }
            ];

            const downbeats = calculateMarkerLegendCounts(
                mainMarkers,
                stems,
                marker_item => marker_item.type === 'beat' && Boolean(marker_item.isDownbeat)
            );

            expect(downbeats).toEqual([
                { label: 'Main Track', count: 1, color: '#fff' },
                { label: 'drums', count: 2, color: '#ef4444' },
                { label: 'bass', count: 0, color: '#f59e0b' }
            ]);
        });
    });
});
