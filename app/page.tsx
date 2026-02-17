"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export default function Home() {
  const router = useRouter();
  const { user, role, loading, profileLoading } = useAuth();

  useEffect(() => {
    if (loading || profileLoading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    switch (role) {
      case "admin":
        router.replace("/admin");
        break;
      case "student":
        router.replace("/student");
        break;
      case "rejected":
      case "pending":
      default:
        router.replace("/pending-approval");
        break;
    }
  }, [user, role, loading, profileLoading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoadingSpinner size="lg" />
    </div>
  );
}
