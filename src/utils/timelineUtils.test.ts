import { describe, it, expect } from 'vitest';
import { formatTime, hexToRgba, buildTimelineRows } from './timelineUtils';
import type { VideoClip } from '../types/assembler';

describe('timelineUtils', () => {
    describe('formatTime', () => {
        it('formats 0 seconds correctly', () => {
            expect(formatTime(0)).toBe('0:00.00');
        });

        it('formats exact minutes correctly', () => {
            expect(formatTime(120)).toBe('2:00.00');
        });

        it('formats seconds and parts of seconds correctly', () => {
            expect(formatTime(65.123)).toBe('1:05.12');
            expect(formatTime(15.9)).toBe('0:15.90');
        });
    });

    describe('hexToRgba', () => {
        it('converts hex to rgba string correctly', () => {
            expect(hexToRgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
            expect(hexToRgba('#00ff00', 1)).toBe('rgba(0, 255, 0, 1)');
            expect(hexToRgba('#0000ff', 0)).toBe('rgba(0, 0, 255, 0)');
        });
    });

    describe('buildTimelineRows', () => {
        it('returns empty array if trackDuration is 0', () => {
            const clips: VideoClip[] = [];
            expect(buildTimelineRows(clips, 0)).toEqual([]);
            expect(buildTimelineRows(clips, -5)).toEqual([]);
        });

        it('creates a single unselected row if there are no clips', () => {
            const clips: VideoClip[] = [];
            const result = buildTimelineRows(clips, 60);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'unselected',
                startTime: 0,
                endTime: 60,
                duration: 60,
                label: 'Unselected',
            });
        });

        it('creates an unselected gap before the first clip', () => {
            const clips: VideoClip[] = [{
                id: '1',
                startTime: 10,
                endTime: 20,
                duration: 10,
                track: 1,
                status: 'done',
                source: 'main',
                label: 'Clip 1'
            }];

            const result = buildTimelineRows(clips, 60);
            expect(result).toHaveLength(3); // Gap before, Clip, Gap after

            expect(result[0].type).toBe('unselected');
            expect(result[0].startTime).toBe(0);
            expect(result[0].endTime).toBe(10);

            expect(result[1].type).toBe('clip');
            expect(result[1].clip?.id).toBe('1');

            expect(result[2].type).toBe('unselected');
            expect(result[2].startTime).toBe(20);
            expect(result[2].endTime).toBe(60);
        });

        it('handles clips that start exactly at 0 without a gap', () => {
            const clips: VideoClip[] = [{
                id: '1',
                startTime: 0,
                endTime: 10,
                duration: 10,
                track: 1,
                status: 'done',
                source: 'main',
                label: 'Clip 1'
            }];

            const result = buildTimelineRows(clips, 60);
            expect(result).toHaveLength(2); // Clip, Gap after

            expect(result[0].type).toBe('clip');
            expect(result[0].startTime).toBe(0);
        });

        it('handles gaps between multiple clips correctly', () => {
            const clips: VideoClip[] = [
                {
                    id: '1',
                    startTime: 10,
                    endTime: 20,
                    duration: 10,
                    track: 1,
                    status: 'done',
                    source: 'main',
                    label: 'Clip 1'
                },
                {
                    id: '2',
                    startTime: 30,
                    endTime: 40,
                    duration: 10,
                    track: 2,
                    status: 'done',
                    source: 'stem',
                    label: 'Clip 2'
                }
            ];

            const result = buildTimelineRows(clips, 60);

            expect(result).toHaveLength(5);
            expect(result[0].type).toBe('unselected'); // 0-10
            expect(result[1].type).toBe('clip'); // 10-20
            expect(result[2].type).toBe('unselected'); // 20-30
            expect(result[3].type).toBe('clip'); // 30-40
            expect(result[4].type).toBe('unselected'); // 40-60

            expect(result[2].startTime).toBe(20);
            expect(result[2].endTime).toBe(30);
            expect(result[2].duration).toBe(10);
        });

        it('handles contiguous clips without gaps', () => {
            const clips: VideoClip[] = [
                {
                    id: '1',
                    startTime: 10,
                    endTime: 20,
                    duration: 10,
                    track: 1,
                    status: 'done',
                    source: 'main',
                    label: 'Clip 1'
                },
                {
                    id: '2',
                    startTime: 20,
                    endTime: 30,
                    duration: 10,
                    track: 2,
                    status: 'done',
                    source: 'stem',
                    label: 'Clip 2'
                }
            ];

            const result = buildTimelineRows(clips, 60);

            expect(result).toHaveLength(4); // 0-10 gap, clip 1, clip 2, 30-60 gap
            expect(result[0].type).toBe('unselected');
            expect(result[1].type).toBe('clip');
            expect(result[1].clip?.id).toBe('1');
            expect(result[2].type).toBe('clip');
            expect(result[2].clip?.id).toBe('2');
            expect(result[3].type).toBe('unselected');
        });
    });
});
