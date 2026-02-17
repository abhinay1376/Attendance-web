"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { ADMIN_EMAIL } from "./constants";

export interface UserProfile {
  email: string;
  name?: string;
  regNo?: string;
  branch?: string;
  sectionId?: string;
  phone?: string;
  approved?: boolean | null;
  allowBackdatedAttendance?: boolean;
  allowFutureAttendance?: boolean;
  initialAttendance?: {
    attended: number;
    total: number;
    uptoDate: string;
  };
}

export type UserRole = "admin" | "student" | "pending" | "rejected" | null;

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  role: UserRole;
  loading: boolean;
  profileLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  role: null,
  loading: true,
  profileLoading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  // Determine role from user + profile
  const deriveRole = useCallback((u: User | null, p: UserProfile | null): UserRole => {
    if (!u) return null;
    if (u.email === ADMIN_EMAIL) return "admin";
    if (!p) return "pending"; // profile not loaded yet, treat as pending
    if (p.approved === true) return "student";
    if (p.approved === false) return "rejected";
    return "pending";
  }, []);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);

      // Cleanup previous profile listener
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!firebaseUser) {
        setProfile(null);
        setRole(null);
        setProfileLoading(false);
        return;
      }

      // Admin doesn't need profile from Firestore for routing
      if (firebaseUser.email === ADMIN_EMAIL) {
        setRole("admin");
        setProfileLoading(false);
        return;
      }

      // Listen to user profile in Firestore
      setProfileLoading(true);
      unsubProfile = onSnapshot(
        doc(db, "users", firebaseUser.uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setProfile(data);
            setRole(deriveRole(firebaseUser, data));
          } else {
            setProfile(null);
            setRole("pending");
          }
          setProfileLoading(false);
        },
        () => {
          // On error, set safe defaults
          setProfile(null);
          setRole("pending");
          setProfileLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, [deriveRole]);

  return (
    <AuthContext.Provider value={{ user, profile, role, loading, profileLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
