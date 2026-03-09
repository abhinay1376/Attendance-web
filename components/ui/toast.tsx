"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
    setTimeout(() => dismiss(id), 3500);
  }, [dismiss]);

  const ctx: ToastContextValue = {
    success: (m) => show("success", m),
    error: (m) => show("error", m),
    warning: (m) => show("warning", m),
    info: (m) => show("info", m),
  };

  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />,
    error: <XCircle className="h-4 w-4 text-rose-500 shrink-0" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />,
    info: <Info className="h-4 w-4 text-blue-500 shrink-0" />,
  };

  const borders: Record<ToastType, string> = {
    success: "border-emerald-200 dark:border-emerald-800",
    error: "border-rose-200 dark:border-rose-800",
    warning: "border-amber-200 dark:border-amber-800",
    info: "border-blue-200 dark:border-blue-800",
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white dark:bg-neutral-900 px-4 py-3 shadow-xl max-w-sm text-sm text-neutral-800 dark:text-neutral-100 ${borders[toast.type]}`}
            >
              {icons[toast.type]}
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button
                onClick={() => dismiss(toast.id)}
                className="ml-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
