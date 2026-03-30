import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const TooltipProvider = TooltipPrimitive.Provider

const TooltipRoot = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded bg-[#2a2a35] border border-gray-600/50 px-3 py-1.5 text-xs font-medium text-gray-200 shadow-xl",
      "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

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
