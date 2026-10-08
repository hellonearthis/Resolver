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
  // WHAT: Verify that the tooltip trigger and fallback container mount cleanly within a TooltipProvider.
  // WHY: Validates backwards-compatibility with existing screens wrapped in TooltipProvider.
  it('renders trigger element and content within TooltipProvider', () => {
    render(
      <TooltipProvider>
        <AppTooltip content="Helpful information">
          <button type="button">Hover Me</button>
        </AppTooltip>
      </TooltipProvider>
    );

    const interactive_trigger_button = screen.getByRole('button', { name: 'Hover Me' });
    expect(interactive_trigger_button).toBeTruthy();
  });

  // WHAT: Verify that hovering the trigger reveals the portal-rendered tooltip content.
  // WHY: Validates Floating UI interaction event wiring and DOM mount transitions.
  it('renders tooltip content when hovered', async () => {
    render(
      <TooltipProvider>
        <AppTooltip content="Floating UI Content" delayDuration={0}>
          <button type="button">Hover Target</button>
        </AppTooltip>
      </TooltipProvider>
    );

    const interactive_trigger_button = screen.getByRole('button', { name: 'Hover Target' });
    fireEvent.mouseEnter(interactive_trigger_button);

    await waitFor(() => {
      const rendered_tooltip_content_element = screen.getByText('Floating UI Content');
      expect(rendered_tooltip_content_element).toBeTruthy();
    });
  });

  // WHAT: Test the dynamicVerticalShift16 middleware downward offset behavior when within screen bounds.
  // WHY: Ensures the tooltip reliably renders 16px lower when there is sufficient viewport vertical clearance.
  it('middleware dynamicVerticalShift16 shifts 16px lower when within viewport', async () => {
    window.innerHeight = 1000;

    // WHAT: Construct test middleware context with 200px initial Y coordinate and 40px tooltip height.
    // WHY: 200 + 16 = 216. 216 + 40 = 256, which fits comfortably within the 1000px viewport height limit.
    const calculated_middleware_position_result = await dynamicVerticalShift16.fn({
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

    expect(calculated_middleware_position_result).toEqual({ y: 216 });
  });

  // WHAT: Test the dynamicVerticalShift16 middleware upward flip behavior when downward offset would overflow.
  // WHY: Ensures that tooltips near the bottom edge flip 16px higher so content is not truncated off-screen.
  it('middleware dynamicVerticalShift16 shifts 16px higher when 16px lower would overflow viewport', async () => {
    window.innerHeight = 800;

    // WHAT: Construct test middleware context with 760px initial Y coordinate and 40px tooltip height.
    // WHY: 760 + 16 = 776. 776 + 40 = 816, which exceeds the 800px viewport boundary, triggering the flip to 760 - 16 = 744.
    const calculated_middleware_position_result = await dynamicVerticalShift16.fn({
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

    expect(calculated_middleware_position_result).toEqual({ y: 744 });
  });
});
