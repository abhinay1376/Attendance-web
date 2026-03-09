"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WifiOff, Wifi } from "lucide-react";

export function NetworkBanner() {
  const [isOnline, setIsOnline] = useState(true);
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
      setIsOnline(false);
      setShowRestored(false);
    };
    const handleOnline = () => {
      setIsOnline(true);
      setShowRestored(true);
      setTimeout(() => setShowRestored(false), 3000);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const show = !isOnline || showRestored;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className={`fixed top-0 left-0 right-0 z-[10000] flex items-center justify-center gap-2 py-2 text-sm font-medium ${
            isOnline
              ? "bg-emerald-500 text-white"
              : "bg-amber-500 text-white"
          }`}
        >
          {isOnline ? (
            <>
              <Wifi className="h-4 w-4" />
              Back online
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4" />
              You&apos;re offline — changes will sync when reconnected
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
