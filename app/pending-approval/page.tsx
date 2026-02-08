"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ADMIN_EMAIL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTransition } from "@/components/page-transition";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AlertCircle } from "lucide-react";

interface UserData {
  email: string;
  name?: string;
  regNo?: string;
  branch?: string;
  sectionId?: string;
  phone?: string;
  approved?: boolean;
}

interface Section {
  id: string;
  name: string;
}

export default function PendingApprovalPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [sectionName, setSectionName] = useState<string>("");

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push("/login");
      } else if (user.email === ADMIN_EMAIL) {
        router.push("/admin");
      }
    }
  }, [user, loading, router]);

  // Load user data and listen for approval changes (auto-redirect)
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(doc(db, "users", user.uid), async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as UserData;
        setUserData(data);

        // Auto-redirect when approved
        if (data.approved === true) {
          router.push("/student");
          return;
        }

        // Load section name if sectionId exists
        if (data.sectionId) {
          const sectionDoc = await getDoc(doc(db, "sections", data.sectionId));
          if (sectionDoc.exists()) {
            setSectionName(sectionDoc.data().name);
          }
        }
      }
    });

    return () => unsubscribe();
  }, [user, router]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user || user.email === ADMIN_EMAIL) {
    return null;
  }

  return (
    <PageTransition>
      <div className="flex min-h-screen items-center justify-center page-background p-4">
        <Card elevation={4} className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/20">
              <AlertCircle className="h-8 w-8 text-yellow-600 dark:text-yellow-500" />
            </div>
            <CardTitle className="text-2xl">Pending Approval</CardTitle>
            <CardDescription>
              Your account is waiting for admin approval
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="space-y-3">
                {userData?.name && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Full Name
                    </p>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                      {userData.name}
                    </p>
                  </div>
                )}
                {userData?.regNo && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Registration Number
                    </p>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50 font-mono">
                      {userData.regNo}
                    </p>
                  </div>
                )}
                {userData?.branch && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Branch
                    </p>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                      {userData.branch}
                    </p>
                  </div>
                )}
                {sectionName && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Section
                    </p>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                      {sectionName}
                    </p>
                  </div>
                )}
                {userData?.phone && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Phone Number
                    </p>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                      {userData.phone}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    Email Address
                  </p>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                    {user?.email}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    Status
                  </p>
                  <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-yellow-100 px-3 py-1 dark:bg-yellow-900/30">
                    <span className="h-2 w-2 rounded-full bg-yellow-500"></span>
                    <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-500">
                      Awaiting Approval
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
              <p className="text-sm text-blue-900 dark:text-blue-200">
                An administrator needs to approve your account before you can mark attendance. 
                You'll be able to access the student dashboard once approved.
              </p>
            </div>

            <Button
              onClick={handleSignOut}
              variant="outline"
              className="w-full"
            >
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  );
}
