/**
 * src/components/ui/Tooltip.test.tsx
 * 
 * Unit tests for AppTooltip and Floating UI dynamicVerticalShift16 middleware:
 * - 16 pixels lower by default when on screen
 * - 16 pixels higher if placing 16px lower puts it off-screen
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider, AppTooltip, dynamicVerticalShift16 } from './Tooltip';

describe('AppTooltip', () => {
  it('renders trigger element and content within TooltipProvider', () => {
    render(
      <TooltipProvider>
        <AppTooltip content="Helpful information">
          <button type="button">Hover Me</button>
        </AppTooltip>
      </TooltipProvider>
    );

    expect(screen.getByRole('button', { name: 'Hover Me' })).toBeTruthy();
  });

  it('renders tooltip content when hovered', async () => {
    render(
      <TooltipProvider>
        <AppTooltip content="Floating UI Content" delayDuration={0}>
          <button type="button">Hover Target</button>
        </AppTooltip>
      </TooltipProvider>
    );

    const button = screen.getByRole('button', { name: 'Hover Target' });
    fireEvent.mouseEnter(button);

    await waitFor(() => {
      expect(screen.getByText('Floating UI Content')).toBeTruthy();
    });
  });

  it('middleware dynamicVerticalShift16 shifts 16px lower when within viewport', async () => {
    // Mock viewport height
    window.innerHeight = 1000;

    // Simulate y = 200, floating height = 40.
    // lowerY = 200 + 16 = 216. 216 + 40 = 256 <= 1000 => { y: 216 }
    const result = await dynamicVerticalShift16.fn({
      x: 100,
      y: 200,
      initialPlacement: 'top',
      placement: 'top',
      strategy: 'absolute',
      middlewareData: {},
      elements: {} as any,
      rects: {
        reference: { x: 100, y: 150, width: 80, height: 30 },
        floating: { x: 100, y: 200, width: 120, height: 40 },
      },
      platform: {} as any,
    });

    expect(result).toEqual({ y: 216 });
  });

  it('middleware dynamicVerticalShift16 shifts 16px higher when 16px lower would overflow viewport', async () => {
    window.innerHeight = 800;

    // Simulate y = 760, floating height = 40.
    // lowerY = 760 + 16 = 776. 776 + 40 = 816 > 800 => { y: 760 - 16 = 744 }
    const result = await dynamicVerticalShift16.fn({
      x: 100,
      y: 760,
      initialPlacement: 'top',
      placement: 'top',
      strategy: 'absolute',
      middlewareData: {},
      elements: {} as any,
      rects: {
        reference: { x: 100, y: 700, width: 80, height: 30 },
        floating: { x: 100, y: 760, width: 120, height: 40 },
      },
      platform: {} as any,
    });

    expect(result).toEqual({ y: 744 });
  });
});
