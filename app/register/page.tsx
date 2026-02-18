"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { createUserWithEmailAndPassword, deleteUser } from "firebase/auth";
import { doc, setDoc, collection, onSnapshot, query, where, getDocs, limit, addDoc } from "firebase/firestore";
import { motion } from "framer-motion";

import { auth, db } from "@/lib/firebase";
import { ADMIN_EMAIL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

interface Section {
  id: string;
  name: string;
  active: boolean;
}

export default function RegisterPage() {
  const router = useRouter();

  // Form fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [regNo, setRegNo] = useState("");
  const [branch, setBranch] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [phone, setPhone] = useState("");

  // UI state
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load active sections
  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, "sections"), where("active", "==", true)),
      (snapshot) => {
        const sectionsData = snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name,
          active: doc.data().active,
        }));
        setSections(sectionsData);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    // Validate fields
    if (!name.trim()) {
      setError("Full name is required");
      return;
    }
    if (!/^[a-z0-9]{8,12}$/.test(regNo)) {
      setError("Registration number must be 8-12 lowercase alphanumeric characters");
      return;
    }
    if (!branch.trim()) {
      setError("Branch is required");
      return;
    }
    if (!sectionId) {
      setError("Section is required");
      return;
    }
    if (!/^\d{10}$/.test(phone)) {
      setError("Phone number must be exactly 10 digits");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);

    try {
      // Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Check uniqueness
      try {
        const regSnap = await getDocs(
          query(collection(db, "users"), where("regNo", "==", regNo.toLowerCase()), limit(1))
        );
        if (!regSnap.empty) {
          await deleteUser(user);
          setError("Registration number already exists");
          setIsLoading(false);
          return;
        }

        const phoneSnap = await getDocs(
          query(collection(db, "users"), where("phone", "==", phone), limit(1))
        );
        if (!phoneSnap.empty) {
          await deleteUser(user);
          setError("Phone number already registered");
          setIsLoading(false);
          return;
        }
      } catch {
        await deleteUser(user).catch(() => { });
        setError("Unable to verify details. Please try again.");
        setIsLoading(false);
        return;
      }

      // Create Firestore user doc
      // approved is intentionally NOT set — undefined means "pending"
      // (approved: true = approved, approved: false = rejected, not set = pending)
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        name: name.trim(),
        regNo: regNo.toLowerCase(),
        branch: branch.trim(),
        sectionId: sectionId,
        phone: phone,
        allowBackdatedAttendance: false,
        allowFutureAttendance: false,
        createdAt: Date.now(),
      });

      // Create notification for admin
      await addDoc(collection(db, "notifications"), {
        type: "NEW_REGISTRATION",
        message: "New student registration pending approval",
        userId: user.uid,
        userName: name.trim(),
        regNo: regNo.toLowerCase(),
        createdAt: Date.now(),
        read: false,
      });

      router.push("/pending-approval");
    } catch (err) {
      const firebaseMessage = err instanceof Error ? err.message : "Unable to create account.";
      if (firebaseMessage.includes("email-already-in-use")) {
        setError("This email is already registered. Please sign in instead.");
      } else if (firebaseMessage.includes("weak-password")) {
        setError("Password must be at least 6 characters.");
      } else if (firebaseMessage.includes("invalid-email")) {
        setError("Please enter a valid email address.");
      } else {
        setError(firebaseMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center page-background px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Card elevation={4}>
          <CardHeader>
            <CardTitle>Create account</CardTitle>
            <CardDescription>Enter your details to register</CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Create a password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Full Name
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="regNo" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Registration Number
                </label>
                <Input
                  id="regNo"
                  type="text"
                  placeholder="24091a3203"
                  required
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value.toLowerCase())}
                  className="font-mono"
                />
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  8-12 lowercase alphanumeric characters
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="branch" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Branch
                </label>
                <Input
                  id="branch"
                  type="text"
                  placeholder="CSE, ECE, etc."
                  required
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="section" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Section
                </label>
                <Select value={sectionId} onValueChange={setSectionId} required>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select your section" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label htmlFor="phone" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Phone Number
                </label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="9876543210"
                  maxLength={10}
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                />
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  10 digits only
                </p>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? <LoadingSpinner size="sm" /> : "Create Account"}
              </Button>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
                Already have an account?{" "}
                <Link href="/login" className="font-medium text-neutral-900 dark:text-neutral-50">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
