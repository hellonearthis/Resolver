/**
 * src/components/storyboard/StoryboardContextMenu.test.tsx
 * 
 * Unit tests for StoryboardContextMenu:
 * - Rendering card info and duration
 * - Quick divide presets (2, 3, 4 parts)
 * - Custom division stepper
 * - Musical beat division
 * - Action callbacks (duplicate, mute, delete, close)
 * - Escape key dismissal
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StoryboardContextMenu from './StoryboardContextMenu';
import type { VideoClip } from '../../types/assembler';

describe('StoryboardContextMenu', () => {
    const mockCard: VideoClip = {
        id: 'card-test-1',
        startTime: 2.0,
        duration: 4.0,
        endTime: 6.0,
        track: 1,
        status: 'pending',
        source: 'main',
        label: 'Shot 2',
        sceneNumber: '1',
        shotLetter: 'A',
        notes: { action: 'Wide neon alley', dialogue: '', sound: '' }
    };

    it('renders the context menu with card label, duration, and frame info', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                frameRate={24}
            />
        );

        expect(screen.getByText('Divide Shot 2')).toBeTruthy();
        expect(screen.getByText('⏱️ 4.00s')).toBeTruthy();
        expect(screen.getByText(/96 frames @ 24fps/)).toBeTruthy();
    });

    it('triggers onDivide with 2 when clicking 2 Parts', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
            />
        );

        const btn2 = screen.getByText('2 Parts');
        fireEvent.click(btn2);

        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 2);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('triggers onDivide with 3 when clicking 3 Parts', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
            />
        );

        const btn3 = screen.getByText('3 Parts');
        fireEvent.click(btn3);

        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 3);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('triggers onDivide with 4 when clicking 4 Parts', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
            />
        );

        const btn4 = screen.getByText('4 Parts');
        fireEvent.click(btn4);

        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 4);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('allows custom division with stepper and divide button', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
            />
        );

        // Click '+' button twice: 2 -> 3 -> 4
        const plusButton = screen.getByText('+');
        fireEvent.click(plusButton);
        fireEvent.click(plusButton);

        const divideButton = screen.getByRole('button', { name: /Divide/i });
        fireEvent.click(divideButton);

        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 4);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('renders musical beat divide option when beatTimestamps are provided', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();
        const onDivideAtBeatsMock = vi.fn();
        const beats = [3.0, 4.0, 5.0];

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                onDivideAtBeats={onDivideAtBeatsMock}
                beatTimestamps={beats}
            />
        );

        expect(screen.getByText('Divide at Musical Beats')).toBeTruthy();
        expect(screen.getByText('4 cuts')).toBeTruthy();

        fireEvent.click(screen.getByText('Divide at Musical Beats'));
        expect(onDivideAtBeatsMock).toHaveBeenCalledWith(mockCard, beats);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('triggers onDuplicate, onToggleMute, and onDelete callbacks', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();
        const onDuplicateMock = vi.fn();
        const onToggleMuteMock = vi.fn();
        const onDeleteMock = vi.fn();

        const { unmount } = render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                onDuplicate={onDuplicateMock}
                onToggleMute={onToggleMuteMock}
                onDelete={onDeleteMock}
            />
        );

        fireEvent.click(screen.getByTitle('Duplicate this shot'));
        expect(onDuplicateMock).toHaveBeenCalledWith(mockCard);

        fireEvent.click(screen.getByTitle('Toggle Alternate/Mute take'));
        expect(onToggleMuteMock).toHaveBeenCalledWith(mockCard);

        fireEvent.click(screen.getByTitle('Delete this shot'));
        expect(onDeleteMock).toHaveBeenCalledWith(mockCard.id);
        unmount();
    });

    it('closes on Escape key press', () => {
        const onCloseMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={vi.fn()}
            />
        );

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCloseMock).toHaveBeenCalled();
    });
});
