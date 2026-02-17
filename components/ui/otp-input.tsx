"use client";

import { useRef, useState, KeyboardEvent, ClipboardEvent, ChangeEvent } from "react";
import { cn } from "@/lib/utils";

interface OTPInputProps {
    length?: number;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    error?: boolean;
    className?: string;
}

export function OTPInput({
    length = 6,
    value,
    onChange,
    disabled = false,
    error = false,
    className,
}: OTPInputProps) {
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    // Ensure value is always the correct length
    const digits = value.padEnd(length, " ").slice(0, length).split("");

    const handleChange = (index: number, newValue: string) => {
        if (disabled) return;

        // Only allow digits
        const sanitized = newValue.replace(/\D/g, "");
        if (sanitized.length === 0) {
            // Handle deletion
            const newDigits = [...digits];
            newDigits[index] = " ";
            onChange(newDigits.join("").trim());
            return;
        }

        // Handle single digit input
        if (sanitized.length === 1) {
            const newDigits = [...digits];
            newDigits[index] = sanitized;
            onChange(newDigits.join("").trim());

            // Auto-focus next input
            if (index < length - 1) {
                inputRefs.current[index + 1]?.focus();
            }
            return;
        }

        // Handle paste of multiple digits
        const pastedDigits = sanitized.slice(0, length);
        const newDigits = pastedDigits.padEnd(length, " ").split("");
        onChange(newDigits.join("").trim());

        // Focus the next empty input or the last one
        const nextEmptyIndex = newDigits.findIndex((d) => d === " ");
        const focusIndex = nextEmptyIndex === -1 ? length - 1 : Math.min(nextEmptyIndex, length - 1);
        inputRefs.current[focusIndex]?.focus();
    };

    const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;

        if (e.key === "Backspace") {
            if (digits[index] === " " && index > 0) {
                // If current is empty, move to previous and delete
                const newDigits = [...digits];
                newDigits[index - 1] = " ";
                onChange(newDigits.join("").trim());
                inputRefs.current[index - 1]?.focus();
            } else {
                // Delete current digit
                const newDigits = [...digits];
                newDigits[index] = " ";
                onChange(newDigits.join("").trim());
            }
            e.preventDefault();
        } else if (e.key === "ArrowLeft" && index > 0) {
            inputRefs.current[index - 1]?.focus();
            e.preventDefault();
        } else if (e.key === "ArrowRight" && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
            e.preventDefault();
        } else if (e.key === "Delete") {
            const newDigits = [...digits];
            newDigits[index] = " ";
            onChange(newDigits.join("").trim());
            e.preventDefault();
        }
    };

    const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (disabled) return;

        const pastedData = e.clipboardData.getData("text");
        const sanitized = pastedData.replace(/\D/g, "").slice(0, length);

        if (sanitized.length > 0) {
            const newDigits = sanitized.padEnd(length, " ").split("");
            onChange(newDigits.join("").trim());

            // Focus the next empty input or the last one
            const nextEmptyIndex = newDigits.findIndex((d) => d === " ");
            const focusIndex = nextEmptyIndex === -1 ? length - 1 : Math.min(nextEmptyIndex, length - 1);
            inputRefs.current[focusIndex]?.focus();
        }
    };

    return (
        <div className={cn("flex gap-2 justify-center", className)}>
            {digits.map((digit, index) => (
                <input
                    key={index}
                    ref={(el) => {
                        inputRefs.current[index] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit === " " ? "" : digit}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={handlePaste}
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setFocusedIndex(null)}
                    disabled={disabled}
                    className={cn(
                        "w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-bold rounded-lg border-2 transition-all",
                        "focus:outline-none focus:ring-2 focus:ring-offset-2",
                        error
                            ? "border-red-500 focus:border-red-500 focus:ring-red-500 text-red-600"
                            : focusedIndex === index
                                ? "border-primary focus:border-primary focus:ring-primary"
                                : "border-neutral-300 dark:border-neutral-700",
                        disabled
                            ? "bg-neutral-100 dark:bg-neutral-800 cursor-not-allowed opacity-50"
                            : "bg-white dark:bg-neutral-900",
                        "dark:text-neutral-50"
                    )}
                    aria-label={`Digit ${index + 1} of ${length}`}
                />
            ))}
        </div>
    );
}
