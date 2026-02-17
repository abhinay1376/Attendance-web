import * as React from "react";

import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: 1 | 2 | 3 | 4;
  glass?: boolean;
  depth?: 1 | 2 | 3;
  glow?: "primary" | "success" | "none";
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevation = 2, glass = false, depth, glow = "none", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border text-neutral-950 dark:text-neutral-50",
        // Glass effect
        glass
          ? "glass"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950",
        // Elevation shadows
        !glass && elevation === 1 && "elevation-1",
        !glass && elevation === 2 && "elevation-2",
        !glass && elevation === 3 && "elevation-3",
        !glass && elevation === 4 && "elevation-4",
        // Hover effects
        !glass && "shadow-lift border-glow",
        // 3D depth
        depth === 1 && "depth-1",
        depth === 2 && "depth-2",
        depth === 3 && "depth-3",
        // Glow effects
        glow === "primary" && "glow-primary",
        glow === "success" && "glow-success",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-neutral-500 dark:text-neutral-400", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
