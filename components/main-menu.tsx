"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface MainMenuItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface MainMenuProps {
  title: string;
  subtitle?: string;
  items: MainMenuItem[];
}

export function MainMenu({ title, subtitle, items }: MainMenuProps) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initial = window.location.hash?.replace("#", "");
    if (initial) {
      setActiveId(initial);
    } else if (items[0]?.id) {
      setActiveId(items[0].id);
    }
  }, [items]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter(Boolean) as HTMLElement[];

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0.1, 0.25, 0.5] }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  const renderedItems = useMemo(
    () =>
      items.map((item) => {
        const Icon = item.icon;
        const isActive = activeId === item.id;
        return (
          <a
            key={item.id}
            href={item.href}
            onClick={() => setActiveId(item.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "menu-item flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              "border-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
              "dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50",
              isActive &&
                "menu-item-active border-primary/40 bg-primary/10 text-primary dark:border-primary/50"
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="whitespace-nowrap">{item.label}</span>
          </a>
        );
      }),
    [items, activeId]
  );

  return (
    <div className="w-full">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {title}
          </p>
          {subtitle && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>
          )}
        </div>
        <div className="hidden flex-col gap-2 lg:flex">{renderedItems}</div>
        <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">{renderedItems}</div>
      </div>
    </div>
  );
}
