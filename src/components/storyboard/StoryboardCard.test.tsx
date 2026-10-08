/**
 * src/components/storyboard/StoryboardCard.test.tsx
 * 
 * Component unit tests for StoryboardCard:
 * - Revision badges ('new', 'changed', 'unchanged')
 * - Boneyard alternate take badge & interactive mute toggling
 * - Card label and note updates
 * - Deletion trigger
 * - Keyboard duration nudging
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import StoryboardCard from './StoryboardCard';
import type { VideoClip } from '../../types/assembler';

describe('StoryboardCard', () => {
    const baseMockCard: VideoClip = {
        id: 'card-101',
        startTime: 2.0,
        duration: 4.0,
        endTime: 6.0,
        track: 1,
        status: 'pending',
        source: 'main',
        label: 'INTRO CLOSEUP',
        sceneNumber: '1',
        shotLetter: 'A',
        notes: {
            action: 'Neon headlights reflecting on wet asphalt.',
            dialogue: 'We run tonight.',
            sound: 'Low synth drone'
        }
    };

    it('renders revision badge for new shots (🔵 New)', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();
        const cardWithRevision: VideoClip = { ...baseMockCard, revisionState: 'new' };

        render(
            <TooltipProvider>
                <StoryboardCard card={cardWithRevision} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        const badge = screen.getByText('🔵 New');
        expect(badge).toBeTruthy();
        expect(badge.getAttribute('title')).toContain('New shot - not yet rendered');
    });

    it('renders revision badge for changed shots (🟡 Changed)', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();
        const cardWithRevision: VideoClip = { ...baseMockCard, revisionState: 'changed' };

        render(
            <TooltipProvider>
                <StoryboardCard card={cardWithRevision} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        const badge = screen.getByText('🟡 Changed');
        expect(badge).toBeTruthy();
        expect(badge.getAttribute('title')).toContain('Changed prompt/optics');
    });

    it('renders revision badge for clean/unchanged shots (🟢 Clean)', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();
        const cardWithRevision: VideoClip = { ...baseMockCard, revisionState: 'unchanged' };

        render(
            <TooltipProvider>
                <StoryboardCard card={cardWithRevision} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        const badge = screen.getByText('🟢 Clean');
        expect(badge).toBeTruthy();
        expect(badge.getAttribute('title')).toContain('Up-to-date with last render');
    });

    it('renders boneyard alternate take badge when isMuted is true, prioritizing mute over revision', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();
        const mutedCard: VideoClip = { ...baseMockCard, isMuted: true, revisionState: 'new' };

        render(
            <TooltipProvider>
                <StoryboardCard card={mutedCard} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        // Should show "🔇 Alt Take" rather than revision badge
        expect(screen.getByText('🔇 Alt Take')).toBeTruthy();
        expect(screen.queryByText('🔵 New')).toBeNull();
    });

    it('toggles isMuted state when mute/unmute button is clicked', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();

        const { rerender } = render(
            <TooltipProvider>
                <StoryboardCard card={{ ...baseMockCard, isMuted: false }} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        // Click mute button (🔊)
        const muteButton = screen.getByTitle('Mute take');
        fireEvent.click(muteButton);
        expect(onUpdateMock).toHaveBeenCalledWith('card-101', { isMuted: true });

        // Rerender as muted and click unmute (🔇)
        rerender(
            <TooltipProvider>
                <StoryboardCard card={{ ...baseMockCard, isMuted: true }} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        const unmuteButton = screen.getByTitle('Unmute take');
        fireEvent.click(unmuteButton);
        expect(onUpdateMock).toHaveBeenCalledWith('card-101', { isMuted: false });
    });

    it('updates shot label when input changes', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();

        render(
            <TooltipProvider>
                <StoryboardCard card={baseMockCard} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        const labelInput = screen.getByPlaceholderText('UNNAMED SHOT');
        fireEvent.change(labelInput, { target: { value: 'WIDE REVEAL SHOT' } });

        expect(onUpdateMock).toHaveBeenCalledWith('card-101', { label: 'WIDE REVEAL SHOT' });
    });

    it('triggers onDelete when remove button is clicked', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();

        render(
            <TooltipProvider>
                <StoryboardCard card={baseMockCard} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        const deleteButton = screen.getByText('✕');
        fireEvent.click(deleteButton);

        expect(onDeleteMock).toHaveBeenCalledWith('card-101');
    });

    it('updates action prompt in notes when textarea value changes', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();

        render(
            <TooltipProvider>
                <StoryboardCard card={baseMockCard} onUpdate={onUpdateMock} onDelete={onDeleteMock} />
            </TooltipProvider>
        );

        const textarea = screen.getByDisplayValue('Neon headlights reflecting on wet asphalt.');
        fireEvent.change(textarea, { target: { value: 'Sparks flying in heavy fog.' } });

        expect(onUpdateMock).toHaveBeenCalledWith('card-101', {
            notes: {
                action: 'Sparks flying in heavy fog.',
                dialogue: 'We run tonight.',
                sound: 'Low synth drone'
            }
        });
    });

    it('nudges duration up and down via arrow keys when card is hovered', () => {
        const onUpdateMock = vi.fn();
        const onDeleteMock = vi.fn();

        const { container } = render(
            <TooltipProvider>
                <StoryboardCard card={baseMockCard} onUpdate={onUpdateMock} onDelete={onDeleteMock} frameRate={24} />
            </TooltipProvider>
        );

        const cardElement = container.querySelector('.rounded-xl')!;
        expect(cardElement).toBeTruthy();

        // Mouse enter to trigger hover state
        fireEvent.mouseEnter(cardElement);

        // Fire ArrowUp keydown
        fireEvent.keyDown(window, { key: 'ArrowUp' });
        expect(onUpdateMock).toHaveBeenCalled();
        const firstCall = onUpdateMock.mock.calls[0];
        expect(firstCall[0]).toBe('card-101');
        expect(firstCall[1].duration).toBeGreaterThan(baseMockCard.duration);

        onUpdateMock.mockClear();

        // Fire ArrowDown keydown
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        expect(onUpdateMock).toHaveBeenCalled();
        const secondCall = onUpdateMock.mock.calls[0];
        expect(secondCall[0]).toBe('card-101');
        expect(secondCall[1].duration).toBeLessThan(baseMockCard.duration);
    });

    it('triggers onContextMenu when right-clicking anywhere on the card', () => {
        const onContextMenuMock = vi.fn();

        const { container } = render(
            <TooltipProvider>
                <StoryboardCard card={baseMockCard} onUpdate={vi.fn()} onDelete={vi.fn()} onContextMenu={onContextMenuMock} />
            </TooltipProvider>
        );

        const cardElement = container.querySelector('.rounded-xl')!;
        expect(cardElement).toBeTruthy();

        fireEvent.contextMenu(cardElement);
        expect(onContextMenuMock).toHaveBeenCalledWith(expect.anything(), baseMockCard);
    });

    it('triggers onContextMenu when clicking the ➗ divide button in the card header', () => {
        const onContextMenuMock = vi.fn();

        render(
            <TooltipProvider>
                <StoryboardCard card={baseMockCard} onUpdate={vi.fn()} onDelete={vi.fn()} onContextMenu={onContextMenuMock} />
            </TooltipProvider>
        );

        const divideButton = screen.getByTitle('Divide shot into smaller sections');
        expect(divideButton).toBeTruthy();

        fireEvent.click(divideButton);
        expect(onContextMenuMock).toHaveBeenCalledWith(expect.anything(), baseMockCard);
    });

    it('allows context menu to bubble up when right-clicking on description textareas', () => {
        const onContextMenuMock = vi.fn();

        render(
            <TooltipProvider>
                <StoryboardCard card={baseMockCard} onUpdate={vi.fn()} onDelete={vi.fn()} onContextMenu={onContextMenuMock} />
            </TooltipProvider>
        );

        const actionTextarea = screen.getByPlaceholderText('Describe the clip action for video generation...');
        expect(actionTextarea).toBeTruthy();

        fireEvent.contextMenu(actionTextarea);
        expect(onContextMenuMock).toHaveBeenCalledWith(expect.anything(), baseMockCard);
    });
});

