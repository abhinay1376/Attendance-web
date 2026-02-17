"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface NotificationBellProps {
  count: number;
  onClick: () => void;
  className?: string;
}

export function NotificationBell({ count, onClick, className }: NotificationBellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800",
        className
      )}
      aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
    >
      <Bell className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
      <AnimatePresence>
        {count > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white"
          >
            {count > 99 ? "99+" : count}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

export interface Notification {
  id: string;
  type: "NEW_REGISTRATION" | "STUDENT_APPROVED" | "STUDENT_REJECTED";
  message: string;
  userId: string;
  userName?: string;
  regNo?: string;
  createdAt: number;
  read: boolean;
}

interface NotificationPanelProps {
  notifications: Notification[];
  onNotificationClick: (notification: Notification) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
  isOpen: boolean;
}

export function NotificationPanel({
  notifications,
  onNotificationClick,
  onMarkAllRead,
  onClose,
  isOpen,
}: NotificationPanelProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
          />
          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div className="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-neutral-500">
                    ({unreadCount} unread)
                  </span>
                )}
              </h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  No notifications
                </div>
              ) : (
                <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onClick={() => onNotificationClick(notification)}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface NotificationItemProps {
  notification: Notification;
  onClick: () => void;
}

function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const timeAgo = getTimeAgo(notification.createdAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full p-4 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900",
        !notification.read && "bg-primary/5"
      )}
    >
      <div className="flex items-start gap-3">
        {!notification.read && (
          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
        )}
        <div className={cn("flex-1", notification.read && "pl-5")}>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
            {notification.message}
          </p>
          {notification.userName && (
            <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
              {notification.userName}
              {notification.regNo && (
                <span className="ml-1 font-mono">({notification.regNo})</span>
              )}
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {timeAgo}
          </p>
        </div>
      </div>
    </button>
  );
}

function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
