import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../utils/cn";

const TooltipProvider = TooltipPrimitive.Provider

const TooltipRoot = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, style, ...props }, forwardedRef) => {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [shiftY, setShiftY] = React.useState<number>(16);

  React.useImperativeHandle(forwardedRef, () => contentRef.current as HTMLDivElement);

  React.useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || typeof window === 'undefined') return;

    const evaluatePosition = () => {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const rect = el.getBoundingClientRect();
      
      // Calculate what bottom would be if placed 16px lower relative to baseline
      const baselineBottom = rect.bottom - shiftY;
      const lowerBottom = baselineBottom + 16;
      
      // If 16px lower puts it off-screen at the bottom, shift 16px higher
      if (lowerBottom > viewportHeight) {
        setShiftY(-16);
      } else {
        setShiftY(16);
      }
    };

    evaluatePosition();
    window.addEventListener('resize', evaluatePosition);
    return () => window.removeEventListener('resize', evaluatePosition);
  }, [shiftY]);

  return (
    <TooltipPrimitive.Content
      ref={contentRef}
      sideOffset={sideOffset}
      collisionPadding={16}
      style={{
        ...style,
        marginTop: `${shiftY}px`,
      }}
      className={cn(
        "z-50 overflow-hidden rounded bg-[#2a2a35] border border-gray-600/50 px-3 py-1.5 text-xs font-medium text-gray-200 shadow-xl transition-all duration-75",
        "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export interface AppTooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: "top" | "right" | "bottom" | "left";
  offset?: [number, number]; // [skidding, distance]
  className?: string;
  delayDuration?: number;
}

export const AppTooltip: React.FC<AppTooltipProps> = ({ 
  content, 
  children, 
  placement = "top", 
  offset,
  className,
  delayDuration = 200
}) => {
  if (!content) {
    return <>{children}</>;
  }

  // Handle Tippy offset mapping. Tippy default was usually 0, 10
  const sideOffset = offset ? offset[1] : 8;
  const alignOffset = offset ? offset[0] : 0;

  return (
    <TooltipRoot delayDuration={delayDuration}>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipPrimitive.Portal>
        <TooltipContent 
          side={placement} 
          sideOffset={sideOffset} 
          alignOffset={alignOffset}
          className={className}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[#2a2a35]" />
        </TooltipContent>
      </TooltipPrimitive.Portal>
    </TooltipRoot>
  );
};

export { TooltipRoot, TooltipTrigger, TooltipContent, TooltipProvider }
