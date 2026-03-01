"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label: string; color: string }>;

const ChartContext = React.createContext<{ config: ChartConfig }>({ config: {} });

export function useChartConfig() {
  return React.useContext(ChartContext);
}

/**
 * ChartContainer — wraps ResponsiveContainer and injects CSS vars for colors.
 * All chart fills/strokes should reference var(--color-<key>).
 */
export function ChartContainer({
  config,
  children,
  className,
  height = 280,
}: {
  config: ChartConfig;
  children: React.ReactElement;
  className?: string;
  height?: number | string;
}) {
  const cssVars = Object.fromEntries(
    Object.entries(config).map(([key, { color }]) => [`--color-${key}`, color])
  ) as React.CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div className={cn("w-full", className)} style={{ ...cssVars, height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

/**
 * ChartTooltipContent — use as the `content` prop of recharts <Tooltip />.
 * Reads colors and labels from ChartContainer's config via context.
 * Shows a divider + Total row when `showTotal` is true.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  hideLabel = false,
  labelFormatter,
  showTotal = false,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  className?: string;
  hideLabel?: boolean;
  labelFormatter?: (label: string) => string;
  showTotal?: boolean;
}) {
  const { config } = useChartConfig();
  if (!active || !payload?.length) return null;

  const total = payload.reduce((s: number, e: { value: number }) => s + (e.value || 0), 0);

  return (
    <div
      className={cn(
        "rounded-xl border border-neutral-200/80 bg-white px-3.5 py-2.5 shadow-lg text-xs min-w-[160px]",
        "dark:border-neutral-800 dark:bg-neutral-950",
        className
      )}
    >
      {!hideLabel && label && (
        <p className="mb-2 font-semibold text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry: { dataKey: string; name: string; value: number; color?: string; fill?: string }) => {
          const cfg = config[entry.dataKey];
          const color = cfg?.color || entry.color || entry.fill || "#6366f1";
          return (
            <div key={entry.dataKey} className="flex items-center justify-between gap-5">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: color }}
                />
                <span className="text-neutral-500 dark:text-neutral-400">
                  {cfg?.label || entry.name}
                </span>
              </div>
              <span className="font-semibold tabular-nums text-neutral-800 dark:text-neutral-100">
                {entry.value}
              </span>
            </div>
          );
        })}
        {showTotal && total > 0 && (
          <>
            <div className="my-1.5 border-t border-neutral-100 dark:border-neutral-800" />
            <div className="flex items-center justify-between gap-5">
              <span className="text-neutral-500 dark:text-neutral-400">Total</span>
              <span className="font-bold tabular-nums text-neutral-800 dark:text-neutral-100">{total}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
