"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const gradientButtonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 btn-3d smooth-transition",
    {
        variants: {
            variant: {
                primary: "gradient-bg-1 text-white hover:opacity-90",
                secondary: "gradient-bg-2 text-white hover:opacity-90",
                success: "gradient-bg-4 text-white hover:opacity-90 glow-success",
                info: "gradient-bg-3 text-white hover:opacity-90",
                outline: "border-2 border-neutral-300 dark:border-neutral-700 bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 rounded-md px-3",
                lg: "h-11 rounded-md px-8",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "primary",
            size: "default",
        },
    }
);

export interface GradientButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof gradientButtonVariants> {
    asChild?: boolean;
}

const GradientButton = React.forwardRef<HTMLButtonElement, GradientButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return (
            <Comp
                className={cn(gradientButtonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        );
    }
);
GradientButton.displayName = "GradientButton";

export { GradientButton, gradientButtonVariants };
