"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, addDoc, getDocs, deleteDoc, doc, onSnapshot, setDoc, getDoc, writeBatch, query, where, orderBy, limit } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ADMIN_EMAIL, WEEKDAYS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { PageTransition } from "@/components/page-transition";
import { CalendarIcon, AlertTriangle, Trash2, Clock, UserX, Bell, ChevronDown, Search, RotateCcw, Users, LayoutDashboard, BarChart3, FileText, Menu, X, LogOut, Settings, BookUser, Pencil, Check, Sun, Moon } from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Collapsible } from "@/components/ui/collapsible";
import { SearchInput, SortSelect } from "@/components/ui/search-filter";
import { NotificationBell, NotificationPanel, Notification } from "@/components/ui/notification";

interface Subject {
  id: string;
  name: string;
}

interface Period {
  id: string;
  label: string;
}

interface StudentInfo {
  uid: string;
  email: string;
  name?: string;
  regNo?: string;
  branch?: string;
  sectionId?: string;
  phone?: string;
  approved?: boolean;
  allowBackdatedAttendance?: boolean;
  allowFutureAttendance?: boolean;
  createdAt?: number;
  initialAttendance?: {
    attended: number;
    total: number;
    uptoDate: string;
  };
}

interface Section {
  id: string;
  name: string;
  active: boolean;
}

// ─── NEW TIMETABLE SCHEMA ───
// Firestore doc: timetable/CSE-DS
// Structure: { sections: { A: { monday: [{subject, start, end, classCount}], ... }, B: {...} } }
interface TimetableSlot {
  subject: string;
  start: string;   // HH:mm
  end: string;      // HH:mm
  classCount: number;
}

// The full timetable from Firestore, keyed by section letter → day → slots
type SectionTimetable = Record<string, TimetableSlot[]>; // day → slots
type FullTimetable = Record<string, SectionTimetable>;    // sectionLetter → day → slots

interface Holiday {
  date: string;
  reason: string;
  createdAt: number;
  markedBy: string;
}

interface AppAttendanceData {
  appAttended: number;
  appTotal: number;
}

// ─── UNIFIED ATTENDANCE FORMULA ───
// totalAttended = initialAttendedClasses + appAttendedClasses
// totalClasses  = initialTotalClasses   + appTotalClasses
// percentage    = totalClasses > 0 ? (totalAttended / totalClasses) * 100 : 0
function computeAttendance(initial: { attended: number; total: number } | undefined, app: AppAttendanceData) {
  const initialAttended = initial?.attended ?? 0;
  const initialTotal = initial?.total ?? 0;
  const totalAttended = initialAttended + app.appAttended;
  const totalClasses = initialTotal + app.appTotal;
  const percentage = totalClasses > 0 ? Math.round(((totalAttended / totalClasses) * 100) * 100) / 100 : 0;
  return { initialAttended, initialTotal, totalAttended, totalClasses, percentage, ...app };
}

// Map section Firestore doc IDs (from sections collection) to timetable section letters (A, B, C, D)
// Section name is like "CSE-A", "CSE-B" etc. We extract the last letter.
function sectionNameToLetter(sectionName: string): string {
  // Extract the last character after the last hyphen, e.g. "CSE-A" -> "A"
  const parts = sectionName.split("-");
  return parts[parts.length - 1].toUpperCase();
}

export default function AdminPage() {
  const router = useRouter();
  const { user, role, loading, profileLoading } = useAuth();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [timetable, setTimetable] = useState<FullTimetable>({});
  // Real-time app attendance per student: uid -> { appAttended, appTotal }
  const [appAttendanceMap, setAppAttendanceMap] = useState<Record<string, AppAttendanceData>>({});
  // Last date each student marked any attendance: uid -> "yyyy-MM-dd"
  const [studentActivityMap, setStudentActivityMap] = useState<Record<string, string>>({});
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  
  const [subjectName, setSubjectName] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [isAddingSubject, setIsAddingSubject] = useState(false);
  const [isAddingPeriod, setIsAddingPeriod] = useState(false);

  // Section management
  const [sectionName, setSectionName] = useState("");
  const [isAddingSection, setIsAddingSection] = useState(false);

  // Timetable management
  const [viewSection, setViewSection] = useState("");
  const [newSlotDay, setNewSlotDay] = useState("monday");
  const [newSlotSubject, setNewSlotSubject] = useState("");
  const [newSlotStart, setNewSlotStart] = useState("");
  const [newSlotEnd, setNewSlotEnd] = useState("");
  const [isAddingSlot, setIsAddingSlot] = useState(false);
  const [isDeletingSlot, setIsDeletingSlot] = useState<string | null>(null);
  const [editSlotKey, setEditSlotKey] = useState<string | null>(null);
  const [editSlotSubject, setEditSlotSubject] = useState("");
  const [editSlotStart, setEditSlotStart] = useState("");
  const [editSlotEnd, setEditSlotEnd] = useState("");
  const [isSavingSlot, setIsSavingSlot] = useState(false);

  // Helper: calculate classCount from start/end times
  const ONE_CLASS_DURATION = 50;
  const calculateClassCount = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const [sH, sM] = start.split(':').map(Number);
    const [eH, eM] = end.split(':').map(Number);
    const dur = (eH * 60 + eM) - (sH * 60 + sM);
    return dur > 0 ? Math.ceil(dur / ONE_CLASS_DURATION) : 0;
  };
  const previewClassCount = calculateClassCount(newSlotStart, newSlotEnd);

  // ─── TIMETABLE ADD / DELETE HANDLERS ───
  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewSection || !newSlotDay || !newSlotSubject.trim() || !newSlotStart || !newSlotEnd) return;
    if (previewClassCount <= 0) { alert("End time must be after start time."); return; }

    setIsAddingSlot(true);
    try {
      const timetableRef = doc(db, "timetable", "CSE-DS");
      const snap = await getDoc(timetableRef);
      const data = snap.exists() ? snap.data() : { branch: "CSE-DS", sections: {} };
      const sections = data.sections || {};
      const sectionData = sections[viewSection] || {};
      const daySlots: TimetableSlot[] = sectionData[newSlotDay] || [];

      // Duplicate check
      const dup = daySlots.some(s => s.start === newSlotStart && s.end === newSlotEnd);
      if (dup) { alert("A slot with the same time already exists."); setIsAddingSlot(false); return; }

      daySlots.push({ subject: newSlotSubject.trim(), start: newSlotStart, end: newSlotEnd, classCount: previewClassCount });
      daySlots.sort((a, b) => a.start.localeCompare(b.start));

      sectionData[newSlotDay] = daySlots;
      sections[viewSection] = sectionData;

      await setDoc(timetableRef, { ...data, sections }, { merge: true });
      setNewSlotSubject("");
      setNewSlotStart("");
      setNewSlotEnd("");
    } catch (error) {
      console.error("Error adding slot:", error);
      alert("Error adding timetable entry");
    } finally {
      setIsAddingSlot(false);
    }
  };

  const handleSaveSlot = async (dayKey: string, slotIdx: number) => {
    if (!editSlotSubject.trim() || !editSlotStart || !editSlotEnd) return;
    setIsSavingSlot(true);
    try {
      const timetableRef = doc(db, "timetable", "CSE-DS");
      const snap = await getDoc(timetableRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const sections = data.sections || {};
      const sectionData = sections[viewSection] || {};
      const daySlots: TimetableSlot[] = [...(sectionData[dayKey] || [])];
      const [sH, sM] = editSlotStart.split(":").map(Number);
      const [eH, eM] = editSlotEnd.split(":").map(Number);
      const diffMins = (eH * 60 + eM) - (sH * 60 + sM);
      const classCount = Math.max(1, Math.round(diffMins / 50));
      daySlots[slotIdx] = { subject: editSlotSubject.trim(), start: editSlotStart, end: editSlotEnd, classCount };
      daySlots.sort((a, b) => a.start.localeCompare(b.start));
      sectionData[dayKey] = daySlots;
      sections[viewSection] = sectionData;
      await setDoc(timetableRef, { ...data, sections }, { merge: true });
      setEditSlotKey(null);
    } catch (error) {
      console.error("Error saving slot:", error);
      alert("Error saving timetable entry");
    } finally {
      setIsSavingSlot(false);
    }
  };

  const handleDeleteSlot = async (dayKey: string, slotIdx: number) => {
    const deleteKey = `${dayKey}-${slotIdx}`;
    if (!confirm("Delete this timetable entry?")) return;
    setIsDeletingSlot(deleteKey);
    try {
      const timetableRef = doc(db, "timetable", "CSE-DS");
      const snap = await getDoc(timetableRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const sections = data.sections || {};
      const sectionData = sections[viewSection] || {};
      const daySlots: TimetableSlot[] = [...(sectionData[dayKey] || [])];
      daySlots.splice(slotIdx, 1);
      sectionData[dayKey] = daySlots;
      sections[viewSection] = sectionData;
      await setDoc(timetableRef, { ...data, sections }, { merge: true });
    } catch (error) {
      console.error("Error deleting slot:", error);
      alert("Error deleting timetable entry");
    } finally {
      setIsDeletingSlot(null);
    }
  };

  // Delete user modal state
  const [deleteUserUid, setDeleteUserUid] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Initial attendance form state
  const [selectedStudentUid, setSelectedStudentUid] = useState("");
  const [attended, setAttended] = useState("");
  const [total, setTotal] = useState("");
  const [uptoDate, setUptoDate] = useState("");
  const [uptoDateCalendar, setUptoDateCalendar] = useState<Date | undefined>(undefined);
  const [isSavingInitial, setIsSavingInitial] = useState(false);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [studentPickerSearch, setStudentPickerSearch] = useState("");

  // Holiday state
  const [holidayDate, setHolidayDate] = useState<Date | undefined>(new Date());
  const [holidayReason, setHolidayReason] = useState("");
  const [isAddingHoliday, setIsAddingHoliday] = useState(false);

  // Semester reset state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  // ─── NEW: Navigation & UI State ───
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState("dashboard");
  const [userActivityFilter, setUserActivityFilter] = useState<"active" | "inactive" | null>(null);

  // ─── NEW: Notifications State ───
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  // ─── NEW: Search, Filter & Sort State (per section) ───
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingSort, setPendingSort] = useState<"name" | "date">("name");
  const [approvedSearch, setApprovedSearch] = useState("");
  const [approvedSort, setApprovedSort] = useState<"name" | "attendance">("attendance");
  const [rejectedSearch, setRejectedSearch] = useState("");
  const [rejectedSort, setRejectedSort] = useState<"name" | "date">("name");
  const [attendanceSearchQuery, setAttendanceSearchQuery] = useState("");
  const [attendanceSort, setAttendanceSort] = useState<"name" | "percentage">("percentage");

  // ─── NEW: Restore user state ───
  const [restoringUser, setRestoringUser] = useState<string | null>(null);

  // ─── Student edit modal state ───
  const [editStudentUid, setEditStudentUid] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRegNo, setEditRegNo] = useState("");
  const [editBranch, setEditBranch] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSectionId, setEditSectionId] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Students section search
  const [studentsSearch, setStudentsSearch] = useState("");

  // Mark-all-future loading
  const [isMarkingAllFuture, setIsMarkingAllFuture] = useState(false);

  useEffect(() => {
    if (loading || profileLoading) return;

    if (!user) {
      router.replace("/login");
    } else if (role !== "admin") {
      router.replace("/student");
    }
  }, [user, role, loading, profileLoading, router]);

  // Listen to subjects collection
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(collection(db, "subjects"), (snapshot) => {
      const subjectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
      }));
      setSubjects(subjectsData);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to periods collection
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(collection(db, "periods"), (snapshot) => {
      const periodsData = snapshot.docs.map(doc => ({
        id: doc.id,
        label: doc.data().label,
      }));
      setPeriods(periodsData);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to holidays collection
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(collection(db, "holidays"), (snapshot) => {
      const holidaysData = snapshot.docs.map(doc => ({
        date: doc.id,
        ...doc.data()
      } as Holiday));
      setHolidays(holidaysData.sort((a, b) => a.date.localeCompare(b.date)));
    });

    return () => unsubscribe();
  }, [user]);

  // Load students (non-admin users)
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;

    const loadStudents = async () => {
      const usersSnapshot = await getDocs(collection(db, "users"));
      const studentsData: StudentInfo[] = [];
      
      usersSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.email !== ADMIN_EMAIL) {
          studentsData.push({
            uid: doc.id,
            email: data.email,
            name: data.name,
            regNo: data.regNo,
            branch: data.branch,
            sectionId: data.sectionId,
            phone: data.phone,
            approved: data.approved,
            allowBackdatedAttendance: data.allowBackdatedAttendance,
            createdAt: data.createdAt,
            initialAttendance: data.initialAttendance,
          });
        }
      });
      
      setStudents(studentsData);
    };

    loadStudents();

    // Listen for changes
    const unsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
      const studentsData: StudentInfo[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.email !== ADMIN_EMAIL) {
          studentsData.push({
            uid: doc.id,
            email: data.email,
            name: data.name,
            regNo: data.regNo,
            branch: data.branch,
            sectionId: data.sectionId,
            phone: data.phone,
            approved: data.approved,
            allowBackdatedAttendance: data.allowBackdatedAttendance,
            allowFutureAttendance: data.allowFutureAttendance,
            createdAt: data.createdAt,
            initialAttendance: data.initialAttendance,
          });
        }
      });
      setStudents(studentsData);
    });

    return () => unsubscribe();
  }, [user]);

  // ─── NEW: Listen to notifications ───
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;

    const notificationsRef = collection(db, "notifications");
    const q = query(notificationsRef, orderBy("createdAt", "desc"), limit(50));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notifs: Notification[] = [];
      snapshot.forEach((doc) => {
        notifs.push({ id: doc.id, ...doc.data() } as Notification);
      });
      setNotifications(notifs);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to sections collection
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(collection(db, "sections"), (snapshot) => {
      const sectionsData = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        active: doc.data().active,
      }));
      setSections(sectionsData);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to timetable document (single doc: timetable/CSE-DS with sections MAP)
  // Also auto-sync section letters to the sections collection
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;

    const timetableDocRef = doc(db, "timetable", "CSE-DS");
    const unsubscribe = onSnapshot(
      timetableDocRef,
      async (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const sectionsMap = data.sections || {};
          setTimetable(sectionsMap as FullTimetable);

          // Auto-sync: ensure each timetable section letter has a corresponding
          // document in the "sections" collection (e.g., letter "A" → doc "CSE-DS-A")
          const sectionLetters = Object.keys(sectionsMap);
          for (const letter of sectionLetters) {
            const sectionDocId = `CSE-DS-${letter}`;
            const sectionRef = doc(db, "sections", sectionDocId);
            const sectionSnap = await getDoc(sectionRef);
            if (!sectionSnap.exists()) {
              await setDoc(sectionRef, {
                name: `CSE-DS-${letter}`,
                active: true,
              });
            }
          }
        } else {
          setTimetable({});
        }
      },
      (error) => {
        // Firestore rules may be blocking — show empty state gracefully
        void error;
        setTimetable({});
      }
    );

    return () => unsubscribe();
  }, [user]);

  // ─── REAL-TIME ATTENDANCE AGGREGATION FOR ALL STUDENTS ───
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;
    if (students.length === 0) {
      setAttendanceLoading(false);
      return;
    }

    const approvedStudents = students.filter(s => s.approved === true);
    if (approvedStudents.length === 0) {
      setAttendanceLoading(false);
      return;
    }

    const unsubscribers: (() => void)[] = [];
    const localMap: Record<string, AppAttendanceData> = {};
    const localActivityMap: Record<string, string> = {};
    let loadedCount = 0;

    approvedStudents.forEach((student) => {
      const datesRef = collection(db, "attendance", student.uid, "dates");
      const unsub = onSnapshot(datesRef, (snapshot) => {
        let attended = 0;
        let total = 0;
        let lastDate = "";
        snapshot.forEach((dateDoc) => {
          // dateDoc.id is "yyyy-MM-dd"
          if (dateDoc.id > lastDate) lastDate = dateDoc.id;
          const data = dateDoc.data();
          Object.values(data).forEach((record: any) => {
            if (record && typeof record.status === "string") {
              const count = record.classCount || 1;
              total += count;
              if (record.status === "PRESENT") {
                attended += count;
              }
            }
          });
        });
        localMap[student.uid] = { appAttended: attended, appTotal: total };
        localActivityMap[student.uid] = lastDate;
        loadedCount++;
        setAppAttendanceMap({ ...localMap });
        setStudentActivityMap({ ...localActivityMap });
        if (loadedCount >= approvedStudents.length) {
          setAttendanceLoading(false);
        }
      });
      unsubscribers.push(unsub);
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [user, students]);

  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const prefersDark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setIsDark(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
  }, []);
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectName.trim()) return;

    setIsAddingSubject(true);
    try {
      await addDoc(collection(db, "subjects"), { name: subjectName.trim() });
      setSubjectName("");
    } catch (error) {
      console.error("Error adding subject:", error);
    } finally {
      setIsAddingSubject(false);
    }
  };

  const handleDeleteSubject = async (id: string) => {
    try {
      await deleteDoc(doc(db, "subjects", id));
    } catch (error) {
      console.error("Error deleting subject:", error);
    }
  };

  const handleAddPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodLabel.trim()) return;

    setIsAddingPeriod(true);
    try {
      await addDoc(collection(db, "periods"), { label: periodLabel.trim() });
      setPeriodLabel("");
    } catch (error) {
      console.error("Error adding period:", error);
    } finally {
      setIsAddingPeriod(false);
    }
  };

  const handleDeletePeriod = async (id: string) => {
    try {
      await deleteDoc(doc(db, "periods", id));
    } catch (error) {
      console.error("Error deleting period:", error);
    }
  };

  const handleSaveInitialAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentUid || !attended || !total || !uptoDate) return;

    const attendedNum = parseInt(attended);
    const totalNum = parseInt(total);

    if (isNaN(attendedNum) || isNaN(totalNum) || attendedNum < 0 || totalNum < 0 || attendedNum > totalNum) {
      alert("Invalid attendance numbers");
      return;
    }

    setIsSavingInitial(true);
    try {
      await setDoc(doc(db, "users", selectedStudentUid), {
        email: students.find(s => s.uid === selectedStudentUid)?.email || "",
        initialAttendance: {
          attended: attendedNum,
          total: totalNum,
          uptoDate: uptoDate,
        },
      }, { merge: true });

      setSelectedStudentUid("");
      setAttended("");
      setTotal("");
      setUptoDate("");
      alert("Initial attendance saved successfully");
    } catch (error) {
      console.error("Error saving initial attendance:", error);
      alert("Error saving initial attendance");
    } finally {
      setIsSavingInitial(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayDate || !holidayReason.trim() || !user) return;

    const dateStr = format(holidayDate, "yyyy-MM-dd");
    setIsAddingHoliday(true);

    try {
      // Get a fresh ID token to authenticate the server-side API call
      const adminToken = await user.getIdToken();

      const res = await fetch("/api/mark-holiday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: dateStr,
          reason: holidayReason.trim(),
          adminToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to mark holiday");
      }

      setHolidayReason("");
      alert(data.message ?? "Holiday marked successfully");
    } catch (error) {
      console.error("Error marking holiday:", error);
      alert(error instanceof Error ? error.message : "Error marking holiday");
    } finally {
      setIsAddingHoliday(false);
    }
  };

  const handleApproveStudent = async (uid: string) => {
    try {
      await setDoc(doc(db, "users", uid), { approved: true }, { merge: true });
      
      // Log the approval
      await addDoc(collection(db, "auditLog"), {
        action: "STUDENT_APPROVED",
        studentUid: uid,
        performedBy: user?.email,
        timestamp: Date.now(),
      });

      alert("Student approved successfully");
    } catch (error) {
      console.error("Error approving student:", error);
      alert("Error approving student");
    }
  };

  const handleRejectStudent = async (uid: string) => {
    if (!confirm("Are you sure you want to reject this student? They will need to register again.")) {
      return;
    }

    try {
      await setDoc(doc(db, "users", uid), { approved: false }, { merge: true });
      
      // Log the rejection
      await addDoc(collection(db, "auditLog"), {
        action: "STUDENT_REJECTED",
        studentUid: uid,
        performedBy: user?.email,
        timestamp: Date.now(),
      });

      alert("Student rejected");
    } catch (error) {
      console.error("Error rejecting student:", error);
      alert("Error rejecting student");
    }
  };

  const handleToggleBackdatedAttendance = async (uid: string, currentValue: boolean) => {
    try {
      const newValue = !currentValue;
      await setDoc(doc(db, "users", uid), { allowBackdatedAttendance: newValue }, { merge: true });

      // Log the toggle
      await addDoc(collection(db, "auditLog"), {
        action: newValue ? "BACKDATED_ATTENDANCE_ENABLED" : "BACKDATED_ATTENDANCE_DISABLED",
        studentUid: uid,
        performedBy: user?.email,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Error toggling backdated attendance:", error);
      alert("Error updating backdated attendance permission");
    }
  };

  // ─── NEW: Toggle Future Attendance Permission ───
  const handleToggleFutureAttendance = async (uid: string, currentValue: boolean) => {
    try {
      const newValue = !currentValue;
      await setDoc(doc(db, "users", uid), { allowFutureAttendance: newValue }, { merge: true });

      await addDoc(collection(db, "auditLog"), {
        action: newValue ? "FUTURE_ATTENDANCE_ENABLED" : "FUTURE_ATTENDANCE_DISABLED",
        studentUid: uid,
        performedBy: user?.email,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Error toggling future attendance:", error);
      alert("Error updating future attendance permission");
    }
  };

  // ─── Handle edit save ───
  const handleSaveEdit = async () => {
    if (!editStudentUid) return;
    setIsSavingEdit(true);
    try {
      await setDoc(doc(db, "users", editStudentUid), {
        name: editName.trim(),
        regNo: editRegNo.trim().toLowerCase(),
        branch: editBranch.trim(),
        phone: editPhone.trim(),
        sectionId: editSectionId,
      }, { merge: true });
      setEditStudentUid(null);
    } catch (e) {
      alert("Error saving: " + e);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // ─── Mark ALL approved users for future attendance ───
  const handleMarkAllFutureAttendance = async () => {
    if (!confirm(`Enable future attendance for all ${allApproved.length} approved students?`)) return;
    setIsMarkingAllFuture(true);
    try {
      const batch = writeBatch(db);
      allApproved.forEach(s => {
        batch.update(doc(db, "users", s.uid), { allowFutureAttendance: true });
      });
      await batch.commit();
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setIsMarkingAllFuture(false);
    }
  };

  // ─── NEW: Restore Rejected User ───
  const handleRestoreUser = async (uid: string) => {
    if (!confirm("Restore this user to pending status?")) return;
    setRestoringUser(uid);
    try {
      await setDoc(doc(db, "users", uid), { approved: null }, { merge: true });
      
      await addDoc(collection(db, "auditLog"), {
        action: "USER_RESTORED",
        studentUid: uid,
        performedBy: user?.email,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Error restoring user:", error);
      alert("Error restoring user");
    } finally {
      setRestoringUser(null);
    }
  };

  // ─── NEW: Notification Handlers ───
  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await setDoc(doc(db, "notifications", notification.id), { read: true }, { merge: true });
    }
    setShowNotifications(false);
    // Scroll to users section
    const usersSection = document.getElementById("users");
    if (usersSection) {
      usersSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;

    const batch = writeBatch(db);
    unread.forEach((n) => {
      batch.update(doc(db, "notifications", n.id), { read: true });
    });
    await batch.commit();
  };

  const handleAddSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectionName.trim()) return;

    setIsAddingSection(true);
    try {
      await addDoc(collection(db, "sections"), {
        name: sectionName.trim(),
        active: true,
      });
      setSectionName("");
      alert("Section added successfully");
    } catch (error) {
      console.error("Error adding section:", error);
      alert("Error adding section");
    } finally {
      setIsAddingSection(false);
    }
  };

  const handleToggleSection = async (sectionId: string, currentActive: boolean) => {
    try {
      await setDoc(doc(db, "sections", sectionId), { active: !currentActive }, { merge: true });
    } catch (error) {
      console.error("Error toggling section:", error);
      alert("Error updating section");
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!confirm("Delete this section? Students in this section will need reassignment.")) return;

    try {
      await deleteDoc(doc(db, "sections", sectionId));
      alert("Section deleted");
    } catch (error) {
      console.error("Error deleting section:", error);
      alert("Error deleting section");
    }
  };

  // ─── DELETE USER (with confirmation modal) ───
  const handleDeleteUser = async () => {
    if (!deleteUserUid || deleteConfirmText !== "DELETE") return;

    const student = students.find(s => s.uid === deleteUserUid);
    if (!student) return;

    setIsDeletingUser(true);
    try {
      // 1. Delete user from Firebase Authentication via server API
      const idToken = await user!.getIdToken();
      const authDeleteRes = await fetch("/api/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: deleteUserUid, adminToken: idToken }),
      });
      const authDeleteData = await authDeleteRes.json();
      if (!authDeleteRes.ok) {
        throw new Error(authDeleteData.error || "Failed to delete user from Authentication");
      }

      // 2. Delete all attendance records for this user
      const datesRef = collection(db, "attendance", deleteUserUid, "dates");
      const datesSnapshot = await getDocs(datesRef);
      const batch = writeBatch(db);
      datesSnapshot.forEach((dateDoc) => {
        batch.delete(dateDoc.ref);
      });

      // 3. Delete user document
      batch.delete(doc(db, "users", deleteUserUid));

      // 4. Audit log
      const auditRef = doc(collection(db, "auditLog"));
      batch.set(auditRef, {
        action: "USER_DELETED",
        studentUid: deleteUserUid,
        studentEmail: student.email,
        studentName: student.name || "N/A",
        studentRegNo: student.regNo || "N/A",
        performedBy: user?.email,
        timestamp: Date.now(),
      });

      await batch.commit();

      setDeleteUserUid(null);
      setDeleteConfirmText("");
      alert(`User ${student.name || student.email} fully deleted (Auth + Firestore)`);
    } catch (error) {
      console.error("Error deleting user:", error);
      alert("Error deleting user: " + error);
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleDeleteHoliday = async (dateStr: string) => {
    if (!confirm(`Remove holiday marking for ${dateStr}?`)) return;

    try {
      // Log the action
      await addDoc(collection(db, "auditLog"), {
        action: "HOLIDAY_REMOVED",
        date: dateStr,
        performedBy: user?.email,
        timestamp: Date.now(),
      });

      await deleteDoc(doc(db, "holidays", dateStr));
    } catch (error) {
      console.error("Error removing holiday:", error);
      alert("Error removing holiday");
    }
  };

  const handleSemesterReset = async () => {
    if (resetConfirmText !== "RESET") {
      alert("Please type RESET to confirm");
      return;
    }

    setIsResetting(true);

    try {
      const batch = writeBatch(db);

      // Log the reset action
      const auditRef = doc(collection(db, "auditLog"));
      batch.set(auditRef, {
        action: "SEMESTER_RESET",
        performedBy: user?.email,
        timestamp: Date.now(),
      });

      // Delete all attendance records
      const attendanceSnapshot = await getDocs(collection(db, "attendance"));
      for (const attendanceDoc of attendanceSnapshot.docs) {
        const datesSnapshot = await getDocs(collection(db, "attendance", attendanceDoc.id, "dates"));
        datesSnapshot.forEach(dateDoc => {
          batch.delete(dateDoc.ref);
        });
      }

      // Delete all holidays
      const holidaysSnapshot = await getDocs(collection(db, "holidays"));
      holidaysSnapshot.forEach(holidayDoc => {
        batch.delete(holidayDoc.ref);
      });

      // Delete all subjects
      const subjectsSnapshot = await getDocs(collection(db, "subjects"));
      subjectsSnapshot.forEach(subjectDoc => {
        batch.delete(subjectDoc.ref);
      });

      // Delete all periods
      const periodsSnapshot = await getDocs(collection(db, "periods"));
      periodsSnapshot.forEach(periodDoc => {
        batch.delete(periodDoc.ref);
      });

      // Reset all users (except admin)
      const usersSnapshot = await getDocs(collection(db, "users"));
      usersSnapshot.forEach(userDoc => {
        const userData = userDoc.data();
        if (userData.email !== ADMIN_EMAIL) {
          batch.update(userDoc.ref, {
            initialAttendance: null,
          });
        }
      });

      await batch.commit();

      alert("Semester reset completed successfully");
      setShowResetConfirm(false);
      setResetConfirmText("");
    } catch (error) {
      console.error("Error resetting semester:", error);
      alert("Error resetting semester: " + error);
    } finally {
      setIsResetting(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        {/* Sidebar skeleton */}
        <div className="hidden lg:flex w-64 flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 gap-3">
          <Skeleton className="h-8 w-36 mb-4" />
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
          <div className="mt-auto flex flex-col gap-2">
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </div>
        {/* Main content skeleton */}
        <div className="flex-1 flex flex-col">
          {/* Header skeleton */}
          <div className="h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 flex items-center justify-between">
            <Skeleton className="h-5 w-40" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-lg" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
          </div>
          {/* Content skeleton */}
          <div className="p-4 lg:p-6 space-y-6">
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-12" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            {/* Table skeleton */}
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
              <Skeleton className="h-5 w-48 mb-4" />
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              ))}
            </div>
            {/* Second block skeleton */}
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user || role !== "admin") {
    return null;
  }

  const selectedStudent = students.find(s => s.uid === selectedStudentUid);
  const unreadCount = notifications.filter((n) => !n.read).length;

  // ─── Filter & Sort Logic (per section) ───
  const filterBySearch = (s: StudentInfo, query: string) => {
    if (query === "") return true;
    const q = query.toLowerCase();
    return (
      s.name?.toLowerCase().includes(q) ||
      s.regNo?.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q)
    );
  };

  // Base lists
  const allPending = students.filter(s => s.approved !== true && s.approved !== false);
  const allApproved = students.filter(s => s.approved === true);
  const allRejected = students.filter(s => s.approved === false);

  // Filtered & sorted lists for display
  const pendingStudents = [...allPending]
    .filter(s => filterBySearch(s, pendingSearch))
    .sort((a, b) => {
      if (pendingSort === "name") return (a.name || "").localeCompare(b.name || "");
      return 0;
    });

  const approvedStudents = [...allApproved]
    .filter(s => filterBySearch(s, approvedSearch))
    .sort((a, b) => {
      if (approvedSort === "name") return (a.name || "").localeCompare(b.name || "");
      if (approvedSort === "attendance") {
        const attA = computeAttendance(a.initialAttendance, appAttendanceMap[a.uid] || { appAttended: 0, appTotal: 0 });
        const attB = computeAttendance(b.initialAttendance, appAttendanceMap[b.uid] || { appAttended: 0, appTotal: 0 });
        return attB.percentage - attA.percentage;
      }
      return 0;
    });

  const rejectedStudents = [...allRejected]
    .filter(s => filterBySearch(s, rejectedSearch))
    .sort((a, b) => {
      if (rejectedSort === "name") return (a.name || "").localeCompare(b.name || "");
      return 0;
    });

  // ─── ACTIVITY LOGIC: last 3 working non-holiday non-Sunday days ───
  const holidaySet = new Set(holidays.map(h => h.date));
  const getLast3WorkingDays = (): string[] => {
    const days: string[] = [];
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - 1); // start from yesterday
    while (days.length < 3) {
      const iso = cursor.toISOString().slice(0, 10);
      if (cursor.getDay() !== 0 && !holidaySet.has(iso)) {
        days.push(iso);
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    return days;
  };
  const last3WorkingDays = getLast3WorkingDays();
  const activityCutoff = last3WorkingDays[last3WorkingDays.length - 1]; // oldest of the 3

  const activeStudents = allApproved.filter(s => {
    const lastDate = studentActivityMap[s.uid];
    return lastDate && lastDate >= activityCutoff;
  });
  const inactiveStudents = allApproved.filter(s => {
    const lastDate = studentActivityMap[s.uid];
    return !lastDate || lastDate < activityCutoff;
  });

  const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "students", label: "Students", icon: BookUser },
    { id: "attendance", label: "Attendance", icon: BarChart3 },
    { id: "timetable", label: "Timetable", icon: CalendarIcon },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <PageTransition>
      <div className="min-h-screen page-background">
        {/* ─── TOP NAVIGATION BAR ─── */}
        <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-neutral-800 dark:bg-neutral-950/95">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
              <h1 className="text-lg font-bold">Admin Dashboard</h1>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <NotificationBell count={unreadCount} onClick={() => setShowNotifications(!showNotifications)} />
                <NotificationPanel
                  notifications={notifications}
                  onNotificationClick={handleNotificationClick}
                  onMarkAllRead={handleMarkAllNotificationsRead}
                  onClose={() => setShowNotifications(false)}
                  isOpen={showNotifications}
                />
              </div>
              <span className="hidden text-sm text-neutral-600 dark:text-neutral-400 sm:block">
                {user.email}
              </span>
              <button
                onClick={toggleTheme}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 transition-colors border border-neutral-200 dark:border-neutral-700"
                title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span className="hidden sm:inline text-xs font-medium">{isDark ? "Light" : "Dark"}</span>
              </button>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sign Out</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl">
          <div className="flex">
            {/* ─── DESKTOP SIDEBAR ─── */}
            <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-neutral-200 p-4 dark:border-neutral-800 lg:block">
              <nav className="space-y-1">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCurrentSection(item.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </aside>

            {/* ─── MOBILE SIDEBAR ─── */}
            <AnimatePresence>
              {mobileMenuOpen && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-20 bg-black/50 lg:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                  />
                  <motion.aside
                    initial={{ x: -256 }}
                    animate={{ x: 0 }}
                    exit={{ x: -256 }}
                    transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    className="fixed left-0 top-14 z-20 h-[calc(100vh-3.5rem)] w-64 overflow-y-auto border-r border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 lg:hidden"
                  >
                    <nav className="space-y-1">
                      {menuItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = currentSection === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setCurrentSection(item.id);
                              setMobileMenuOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                            )}
                          >
                            <Icon className="h-4 w-4" />
                            {item.label}
                          </button>
                        );
                      })}

                      {/* Back to Dashboard */}
                      {currentSection !== "dashboard" && (
                        <button
                          type="button"
                          onClick={() => { setCurrentSection("dashboard"); setMobileMenuOpen(false); }}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50 mt-2 pt-3 border-t border-neutral-100 dark:border-neutral-800"
                        >
                          <LayoutDashboard className="h-4 w-4" />
                          Back to Dashboard
                        </button>
                      )}


                    </nav>
                  </motion.aside>
                </>
              )}
            </AnimatePresence>

            {/* ─── MAIN CONTENT ─── */}
            <main className="flex-1 p-3 sm:p-4 lg:p-6">
              <div className="space-y-4 sm:space-y-6">

        <AnimatePresence mode="wait">

        {/* ─── DASHBOARD SECTION ─── */}
        {currentSection === "dashboard" && (
        <motion.section
          id="dashboard"
          key="dashboard"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          <h2 className="text-xl font-bold mb-4 sm:text-2xl">Dashboard Overview</h2>
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            {[
              { label: "Pending", count: allPending.length, color: "blue", section: "users" },
              { label: "Approved", count: allApproved.length, color: "green", section: "users" },
              { label: "Rejected", count: allRejected.length, color: "red", section: "users" },
              { label: "Notifications", count: unreadCount, color: "purple", section: "" },
            ].map((item, i) => (
              <motion.button
                key={item.label}
                type="button"
                onClick={() => item.section ? setCurrentSection(item.section) : setShowNotifications(true)}
                className={`text-left rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 shadow-sm transition-colors hover:border-${item.color}-300 hover:bg-${item.color}-50/50 dark:hover:bg-${item.color}-950/20`}
                initial={{ opacity: 0, y: 16, rotateX: 6 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.28, delay: i * 0.06, ease: "easeOut" }}
                whileHover={{ y: -4, boxShadow: "0 8px 24px rgba(0,0,0,0.10)", transition: { duration: 0.15 } }}
                whileTap={{ scale: 0.97 }}
                style={{ perspective: "600px", transformStyle: "preserve-3d" }}
              >
                <div className="p-3 sm:p-5">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className={`rounded-lg bg-${item.color}-100 dark:bg-${item.color}-900/30 p-1.5 sm:p-2`}>
                      {item.label === "Notifications"
                        ? <Bell className={`h-4 w-4 sm:h-5 sm:w-5 text-${item.color}-600 dark:text-${item.color}-400`} />
                        : <Users className={`h-4 w-4 sm:h-5 sm:w-5 text-${item.color}-600 dark:text-${item.color}-400`} />}
                    </div>
                    <div>
                      <p className="text-xl sm:text-2xl font-bold">{item.count}</p>
                      <p className="text-[10px] sm:text-xs text-neutral-500">{item.label}</p>
                    </div>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>

          {/* Activity cards */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 mt-2 sm:mt-4">
            {[
              { label: "Active Students", count: activeStudents.length, color: "emerald", icon: "active", filter: "active" as const },
              { label: "Not Active", count: inactiveStudents.length, color: "rose", icon: "inactive", filter: "inactive" as const },
            ].map((item, i) => (
              <motion.button
                key={item.label}
                type="button"
                onClick={() => { setUserActivityFilter(item.filter); setCurrentSection("users"); }}
                className={`text-left rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 shadow-sm transition-colors hover:border-${item.color}-300 hover:bg-${item.color}-50/50 dark:hover:bg-${item.color}-950/20`}
                initial={{ opacity: 0, y: 16, rotateX: 6 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.28, delay: 0.24 + i * 0.06, ease: "easeOut" }}
                whileHover={{ y: -4, boxShadow: "0 8px 24px rgba(0,0,0,0.10)", transition: { duration: 0.15 } }}
                whileTap={{ scale: 0.97 }}
                style={{ perspective: "600px", transformStyle: "preserve-3d" }}
              >
                <div className="p-3 sm:p-5">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className={`rounded-lg bg-${item.color}-100 dark:bg-${item.color}-900/30 p-1.5 sm:p-2`}>
                      <Users className={`h-4 w-4 sm:h-5 sm:w-5 text-${item.color}-600 dark:text-${item.color}-400`} />
                    </div>
                    <div>
                      <p className="text-xl sm:text-2xl font-bold">{item.count}</p>
                      <p className="text-[10px] sm:text-xs text-neutral-500">{item.label}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-neutral-400 mt-1.5 pl-0.5">Last 3 working days</p>
                </div>
              </motion.button>
            ))}
          </div>

          {/* Quick links */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {menuItems.filter(m => m.id !== "dashboard").map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  onClick={() => setCurrentSection(item.id)}
                  className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900 transition-colors"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: 0.24 + i * 0.05 }}
                  whileHover={{ y: -2, boxShadow: "0 4px 14px rgba(0,0,0,0.08)", transition: { duration: 0.12 } }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </motion.button>
              );
            })}
          </div>
        </motion.section>
        )}

        {/* ─── USERS SECTION ─── */}
        {currentSection === "users" && (
        <motion.section
          id="users"
          key="users"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          <h2 className="text-xl font-bold mb-4 sm:text-2xl">User Management</h2>

          {/* Pending Users */}
          <Collapsible
            title="Pending Approvals"
            count={allPending.length}
            defaultOpen={allPending.length > 0 && allPending.length <= 10}
            badge={allPending.length > 0 ? <Badge variant="warning">Action Required</Badge> : undefined}
            className="mb-3"
          >
            {/* Search & Sort inside collapsible */}
            {allPending.length > 0 && (
              <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                <SearchInput
                  value={pendingSearch}
                  onChange={setPendingSearch}
                  placeholder="Search pending..."
                  className="w-full sm:w-48"
                />
                <SortSelect
                  options={[
                    { value: "name", label: "Name" },
                  ]}
                  value={pendingSort}
                  onChange={(v) => setPendingSort(v as "name" | "date")}
                  className="w-full sm:w-auto"
                />
              </div>
            )}
            {pendingStudents.length === 0 ? (
              <p className="text-center text-sm text-neutral-500 py-4">
                {pendingSearch ? "No matching users" : "No pending approvals"}
              </p>
            ) : (
              <div className="space-y-2">
                {pendingStudents.map((student) => {
                  const studentSection = student.sectionId ? sections.find(s => s.id === student.sectionId) : null;
                  return (
                    <div
                      key={student.uid}
                      className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{student.name || "No Name"}</p>
                          <p className="text-xs text-neutral-500 font-mono truncate">{student.regNo}</p>
                        </div>
                        <Badge variant="warning" className="shrink-0">Pending</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs mb-2">
                        <div className="truncate"><span className="text-neutral-500">Branch:</span> {student.branch}</div>
                        <div className="truncate"><span className="text-neutral-500">Section:</span> {studentSection?.name || "N/A"}</div>
                        <div className="truncate col-span-2"><span className="text-neutral-500">Phone:</span> {student.phone}</div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApproveStudent(student.uid)}
                          className="flex-1 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRejectStudent(student.uid)}
                          className="flex-1 h-8 text-xs"
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Collapsible>

          {/* Approved Users */}
          <div className="flex items-center justify-between mb-1 mt-1 px-1">
            <span className="text-xs text-neutral-500 font-medium">Approved ({allApproved.length})</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/40"
              onClick={handleMarkAllFutureAttendance}
              disabled={isMarkingAllFuture || allApproved.length === 0}
            >
              {isMarkingAllFuture ? "Updating..." : "✦ Mark all for Future Attendance"}
            </Button>
          </div>
          <Collapsible
            title="Approved Students"
            count={allApproved.length}
            defaultOpen={false}
            className="mb-3"
          >
            {/* Search & Sort inside collapsible */}
            {allApproved.length > 0 && (
              <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                <SearchInput
                  value={approvedSearch}
                  onChange={setApprovedSearch}
                  placeholder="Search approved..."
                  className="w-full sm:w-48"
                />
                <SortSelect
                  options={[
                    { value: "name", label: "Name" },
                    { value: "attendance", label: "Attendance %" },
                  ]}
                  value={approvedSort}
                  onChange={(v) => setApprovedSort(v as "name" | "attendance")}
                  className="w-full sm:w-auto"
                />
              </div>
            )}
            {approvedStudents.length === 0 ? (
              <p className="text-center text-sm text-neutral-500 py-4">
                {approvedSearch ? "No matching students" : "No approved students"}
              </p>
            ) : (
              <div className="space-y-2">
                {approvedStudents.map((student) => {
                  const hasBackdated = student.allowBackdatedAttendance === true;
                  const hasFuture = student.allowFutureAttendance === true;
                  const att = computeAttendance(student.initialAttendance, appAttendanceMap[student.uid] || { appAttended: 0, appTotal: 0 });

                  return (
                    <div
                      key={student.uid}
                      className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          <button
                            className="text-sm font-semibold truncate text-indigo-600 hover:text-indigo-800 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300 text-left"
                            onClick={() => router.push(`/admin/student/${student.uid}`)}
                          >
                            {student.name || "No Name"}
                          </button>
                          <p className="text-xs text-neutral-500 font-mono truncate">{student.regNo}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={cn(
                            "text-xs font-bold px-1.5 py-0.5 rounded",
                            att.percentage >= 75 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" 
                            : att.percentage >= 50 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          )}>
                            {att.percentage}%
                          </span>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => {
                              setDeleteUserUid(student.uid);
                              setDeleteConfirmText("");
                            }}
                            title="Delete user"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Attendance Bar */}
                      <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden mb-2">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            att.percentage >= 75 ? "bg-green-500" : att.percentage >= 50 ? "bg-yellow-500" : "bg-red-500"
                          )}
                          style={{ width: `${Math.min(att.percentage, 100)}%` }}
                        />
                      </div>

                      {/* Permission Toggles - compact */}
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant={hasBackdated ? "default" : "outline"}
                          className={cn("text-[10px] h-6 px-2 flex-1", hasBackdated && "bg-amber-600 hover:bg-amber-700")}
                          onClick={() => handleToggleBackdatedAttendance(student.uid, hasBackdated)}
                        >
                          Backdate {hasBackdated ? "✓" : ""}
                        </Button>
                        <Button
                          size="sm"
                          variant={hasFuture ? "default" : "outline"}
                          className={cn("text-[10px] h-6 px-2 flex-1", hasFuture && "bg-blue-600 hover:bg-blue-700")}
                          onClick={() => handleToggleFutureAttendance(student.uid, hasFuture)}
                        >
                          Future {hasFuture ? "✓" : ""}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Collapsible>

          {/* Rejected Users */}
          <Collapsible
            title="Rejected Users"
            count={allRejected.length}
            defaultOpen={false}
            badge={allRejected.length > 0 ? <Badge variant="error">Rejected</Badge> : undefined}
            className="mb-3"
          >
            {/* Search & Sort inside collapsible */}
            {allRejected.length > 0 && (
              <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                <SearchInput
                  value={rejectedSearch}
                  onChange={setRejectedSearch}
                  placeholder="Search rejected..."
                  className="w-full sm:w-48"
                />
                <SortSelect
                  options={[
                    { value: "name", label: "Name" },
                  ]}
                  value={rejectedSort}
                  onChange={(v) => setRejectedSort(v as "name" | "date")}
                  className="w-full sm:w-auto"
                />
              </div>
            )}
            {rejectedStudents.length === 0 ? (
              <p className="text-center text-sm text-neutral-500 py-4">
                {rejectedSearch ? "No matching users" : "No rejected users"}
              </p>
            ) : (
              <div className="space-y-2">
                {rejectedStudents.map((student) => (
                  <div
                    key={student.uid}
                    className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{student.name || "No Name"}</p>
                        <p className="text-xs text-neutral-500 font-mono truncate">{student.regNo}</p>
                      </div>
                      <Badge variant="error" className="shrink-0">Rejected</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestoreUser(student.uid)}
                        disabled={restoringUser === student.uid}
                        className="flex-1 h-7 text-xs"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        {restoringUser === student.uid ? "..." : "Restore"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setDeleteUserUid(student.uid);
                          setDeleteConfirmText("");
                        }}
                        className="flex-1 h-7 text-xs"
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Collapsible>

          {/* ─── ACTIVITY COLLAPSIBLES ─── */}
          <div className="mt-4 mb-1 px-1">
            <p className="text-xs text-neutral-500 font-medium">
              Activity based on last 3 working days ({last3WorkingDays.slice(-1)[0]} → {last3WorkingDays[0]})
            </p>
          </div>

          {/* Active Users */}
          <Collapsible
            title="Active Students"
            count={activeStudents.length}
            defaultOpen={false}
            open={userActivityFilter === "active" ? true : undefined}
            onOpenChange={() => setUserActivityFilter(null)}
            badge={<Badge variant="success">{activeStudents.length} active</Badge>}
            className="mb-3"
          >
            {activeStudents.length === 0 ? (
              <p className="text-center text-sm text-neutral-500 py-4">No active students in the last 3 working days.</p>
            ) : (
              <div className="space-y-2">
                {activeStudents.map((student, idx) => {
                  const lastDate = studentActivityMap[student.uid];
                  const att = computeAttendance(student.initialAttendance, appAttendanceMap[student.uid] || { appAttended: 0, appTotal: 0 });
                  return (
                    <motion.div
                      key={student.uid}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: idx * 0.03 }}
                      className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20 p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{student.name || "No Name"}</p>
                        <p className="text-xs text-neutral-500 font-mono truncate">{student.regNo}</p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                          Last active: {lastDate}
                        </p>
                      </div>
                      <span className={cn(
                        "text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ml-2",
                        att.percentage >= 75 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : att.percentage >= 50 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {att.totalClasses > 0 ? `${att.percentage.toFixed(0)}%` : "N/A"}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </Collapsible>

          {/* Inactive Users */}
          <Collapsible
            title="Not Active Students"
            count={inactiveStudents.length}
            defaultOpen={false}
            open={userActivityFilter === "inactive" ? true : undefined}
            onOpenChange={() => setUserActivityFilter(null)}
            badge={inactiveStudents.length > 0 ? <Badge variant="error">{inactiveStudents.length} inactive</Badge> : undefined}
            className="mb-3"
          >
            {inactiveStudents.length === 0 ? (
              <p className="text-center text-sm text-neutral-500 py-4">All approved students have been active recently.</p>
            ) : (
              <div className="space-y-2">
                {inactiveStudents.map((student, idx) => {
                  const lastDate = studentActivityMap[student.uid];
                  const att = computeAttendance(student.initialAttendance, appAttendanceMap[student.uid] || { appAttended: 0, appTotal: 0 });
                  return (
                    <motion.div
                      key={student.uid}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: idx * 0.03 }}
                      className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/20 p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{student.name || "No Name"}</p>
                        <p className="text-xs text-neutral-500 font-mono truncate">{student.regNo}</p>
                        <p className="text-[10px] text-rose-500 dark:text-rose-400 mt-0.5">
                          {lastDate ? `Last active: ${lastDate}` : "Never marked attendance"}
                        </p>
                      </div>
                      <span className={cn(
                        "text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ml-2",
                        att.percentage >= 75 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : att.percentage >= 50 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {att.totalClasses > 0 ? `${att.percentage.toFixed(0)}%` : "N/A"}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </Collapsible>

          {/* Initial Attendance Section */}
          <Card elevation={3} id="initial-attendance" className="mt-3">
          <CardHeader>
            <CardTitle>Set Initial Attendance</CardTitle>
            <CardDescription>
              Enter pre-app attendance for students. Students can only mark attendance AFTER the cutoff date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveInitialAttendance} className="space-y-4">
              {/* ─── CUSTOM SEARCHABLE STUDENT PICKER ─── */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Select Student
                </label>
                {(() => {
                  const sorted = [...students].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
                  const filtered = sorted.filter((s) => {
                    const q = studentPickerSearch.toLowerCase();
                    return (
                      (s.name ?? "").toLowerCase().includes(q) ||
                      s.email.toLowerCase().includes(q) ||
                      (s.regNo ?? "").toLowerCase().includes(q)
                    );
                  });
                  const selected = students.find((s) => s.uid === selectedStudentUid);
                  return (
                    <div className="relative">
                      {/* Trigger button */}
                      <button
                        type="button"
                        disabled={isSavingInitial}
                        onClick={() => setStudentPickerOpen((v) => !v)}
                        className="w-full flex items-center justify-between rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                      >
                        <span className={selected ? "" : "text-neutral-400"}>
                          {selected
                            ? `${selected.name ? selected.name + " – " : ""}${selected.email}${
                                selected.initialAttendance
                                  ? ` (${selected.initialAttendance.attended}/${selected.initialAttendance.total})`
                                  : ""
                              }`
                            : "Select a student"}
                        </span>
                        <ChevronDown className={cn("h-4 w-4 text-neutral-400 transition-transform", studentPickerOpen && "rotate-180")} />
                      </button>

                      {/* Dropdown panel */}
                      {studentPickerOpen && (
                        <div className="absolute z-50 mt-1 w-full rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 shadow-lg">
                          {/* Search input */}
                          <div className="p-2 border-b border-neutral-100 dark:border-neutral-800">
                            <div className="flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1">
                              <Search className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                              <input
                                autoFocus
                                className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
                                placeholder="Search by name, email or reg no..."
                                value={studentPickerSearch}
                                onChange={(e) => setStudentPickerSearch(e.target.value)}
                              />
                              {studentPickerSearch && (
                                <button type="button" onClick={() => setStudentPickerSearch("")} className="text-neutral-400 hover:text-neutral-600">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Option: clear */}
                          <button
                            type="button"
                            onClick={() => { setSelectedStudentUid(""); setStudentPickerOpen(false); setStudentPickerSearch(""); }}
                            className="w-full text-left px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800"
                          >
                            — None selected —
                          </button>

                          {/* Student list */}
                          <div className="max-h-56 overflow-y-auto">
                            {filtered.length === 0 ? (
                              <p className="text-center text-xs text-neutral-400 py-4">No students found</p>
                            ) : (
                              filtered.map((s) => (
                                <button
                                  key={s.uid}
                                  type="button"
                                  onClick={() => { setSelectedStudentUid(s.uid); setStudentPickerOpen(false); setStudentPickerSearch(""); }}
                                  className={cn(
                                    "w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors",
                                    s.uid === selectedStudentUid && "bg-primary/10 text-primary"
                                  )}
                                >
                                  <span className="font-medium block truncate">
                                    {s.name || <span className="italic text-neutral-400">No name</span>}
                                    {s.regNo && <span className="ml-1.5 text-[10px] text-neutral-400 font-normal font-mono">{s.regNo}</span>}
                                  </span>
                                  <span className="text-xs text-neutral-500 block truncate">
                                    {s.email}
                                    {s.initialAttendance && (
                                      <span className="ml-1.5 text-blue-500">({s.initialAttendance.attended}/{s.initialAttendance.total})</span>
                                    )}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Classes Attended
                  </label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g., 45"
                    value={attended}
                    onChange={(e) => setAttended(e.target.value)}
                    disabled={isSavingInitial || !selectedStudentUid}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Total Classes
                  </label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g., 60"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    disabled={isSavingInitial || !selectedStudentUid}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Counted Up To Date
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                        disabled={isSavingInitial || !selectedStudentUid}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {uptoDate ? format(new Date(uptoDate), "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={uptoDate ? new Date(uptoDate) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            setUptoDate(format(date, "yyyy-MM-dd"));
                          }
                        }}
                        disabled={isSavingInitial || !selectedStudentUid}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {selectedStudent?.initialAttendance && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Current:</strong> {selectedStudent.initialAttendance.attended}/{selectedStudent.initialAttendance.total} classes (
                    {((selectedStudent.initialAttendance.attended / selectedStudent.initialAttendance.total) * 100).toFixed(1)}%) up to{" "}
                    {new Date(selectedStudent.initialAttendance.uptoDate).toLocaleDateString()}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                disabled={isSavingInitial || !selectedStudentUid || !attended || !total || !uptoDate}
              >
                {isSavingInitial ? "Saving..." : "Save Initial Attendance"}
              </Button>
            </form>
          </CardContent>
        </Card>
        </motion.section>
        )}

        {currentSection === "attendance" && (
        <motion.section
          id="attendance"
          key="attendance"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          <h2 className="text-xl font-bold mb-4 sm:text-2xl">Attendance Overview</h2>
          <Card elevation={3}>
          <CardHeader>
            <CardTitle>Student Attendance</CardTitle>
            <CardDescription>
              Real-time attendance for all approved students (Initial + App = Total)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attendanceLoading ? (
              <div className="space-y-3 py-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                ))}
              </div>
            ) : approvedStudents.length === 0 ? (
              <div className="py-12 text-center">
                <Users className="mx-auto h-10 w-10 text-neutral-300 dark:text-neutral-600 mb-3" />
                <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">No approved students yet</p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">Approve students from the Users section above.</p>
              </div>
            ) : (
              <>
                {/* Search & Sort */}
                <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
                  <SearchInput
                    value={attendanceSearchQuery}
                    onChange={setAttendanceSearchQuery}
                    placeholder="Search students..."
                    className="w-full sm:w-56"
                  />
                  <SortSelect
                    options={[
                      { value: "percentage", label: "Attendance %" },
                      { value: "name", label: "Name" },
                    ]}
                    value={attendanceSort}
                    onChange={(v) => setAttendanceSort(v as "name" | "percentage")}
                    className="w-full sm:w-auto"
                  />
                </div>

                {/* Table */}
                <div className="overflow-x-auto -mx-6 px-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
                        <th className="py-3 pr-3 text-left font-medium text-neutral-600 dark:text-neutral-400">Student</th>
                        <th className="px-3 py-3 text-center font-medium text-neutral-600 dark:text-neutral-400 hidden sm:table-cell">Section</th>
                        <th className="px-3 py-3 text-center font-medium text-neutral-600 dark:text-neutral-400">Initial</th>
                        <th className="px-3 py-3 text-center font-medium text-neutral-600 dark:text-neutral-400">App</th>
                        <th className="px-3 py-3 text-center font-medium text-neutral-600 dark:text-neutral-400">Total</th>
                        <th className="pl-3 py-3 text-right font-medium text-neutral-600 dark:text-neutral-400">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {(() => {
                        const filtered = approvedStudents
                          .filter(s => {
                            if (!attendanceSearchQuery) return true;
                            const q = attendanceSearchQuery.toLowerCase();
                            return s.name?.toLowerCase().includes(q) || s.regNo?.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
                          })
                          .sort((a, b) => {
                            if (attendanceSort === "name") return (a.name || "").localeCompare(b.name || "");
                            const attA = computeAttendance(a.initialAttendance, appAttendanceMap[a.uid] || { appAttended: 0, appTotal: 0 });
                            const attB = computeAttendance(b.initialAttendance, appAttendanceMap[b.uid] || { appAttended: 0, appTotal: 0 });
                            return attB.percentage - attA.percentage;
                          });

                        if (filtered.length === 0) {
                          return (
                            <tr>
                              <td colSpan={6} className="py-8 text-center text-sm text-neutral-500">
                                No matching students found
                              </td>
                            </tr>
                          );
                        }

                        return filtered.map((student, idx) => {
                          const app = appAttendanceMap[student.uid] || { appAttended: 0, appTotal: 0 };
                          const att = computeAttendance(student.initialAttendance, app);
                          const studentSection = student.sectionId ? sections.find(sec => sec.id === student.sectionId) : null;

                          return (
                            <tr
                              key={student.uid}
                              onClick={() => router.push(`/admin/student/${student.uid}`)}
                              className={cn(
                                "cursor-pointer transition-colors hover:bg-primary/5",
                                idx % 2 === 0 ? "bg-white dark:bg-neutral-950" : "bg-neutral-50/50 dark:bg-neutral-900/50"
                              )}
                            >
                              <td className="py-3 pr-3">
                                <p className="font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 truncate max-w-[160px]">
                                  {student.name || "No Name"}
                                </p>
                                <p className="text-xs text-neutral-500 font-mono truncate max-w-[160px]">
                                  {student.regNo || student.email}
                                </p>
                              </td>
                              <td className="px-3 py-3 text-center text-xs text-neutral-600 dark:text-neutral-400 hidden sm:table-cell">
                                {studentSection?.name || "—"}
                              </td>
                              <td className="px-3 py-3 text-center text-xs tabular-nums">
                                {att.initialAttended}/{att.initialTotal}
                              </td>
                              <td className="px-3 py-3 text-center text-xs tabular-nums">
                                {att.appAttended}/{att.appTotal}
                              </td>
                              <td className="px-3 py-3 text-center text-xs font-medium tabular-nums">
                                {att.totalAttended}/{att.totalClasses}
                              </td>
                              <td className="pl-3 py-3 text-right">
                                <span className={cn(
                                  "inline-block min-w-[48px] rounded-full px-2 py-0.5 text-xs font-bold tabular-nums text-center",
                                  att.totalClasses === 0
                                    ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                                    : att.percentage >= 75
                                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                    : att.percentage >= 50
                                    ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"
                                    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                )}>
                                  {att.totalClasses > 0 ? `${att.percentage}%` : "N/A"}
                                </span>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        </motion.section>
        )}

        {/* ─── STUDENTS INFO SECTION ─── */}
        {currentSection === "students" && (
        <motion.section
          id="students"
          key="students"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          <h2 className="text-xl font-bold mb-1 sm:text-2xl">All Students</h2>
          <p className="text-sm text-neutral-500 mb-4">Full profile + attendance for every registered student. Click the edit icon to update details.</p>

          <div className="mb-4">
            <SearchInput
              value={studentsSearch}
              onChange={setStudentsSearch}
              placeholder="Search by name, reg no, email..."
              className="w-full sm:w-72"
            />
          </div>

          {students.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-neutral-500">No students registered yet.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {students
                .filter(s => {
                  if (!studentsSearch) return true;
                  const q = studentsSearch.toLowerCase();
                  return s.name?.toLowerCase().includes(q) || s.regNo?.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
                })
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((student, idx) => {
                  const app = appAttendanceMap[student.uid] || { appAttended: 0, appTotal: 0 };
                  const att = computeAttendance(student.initialAttendance, app);
                  const secName = sections.find(s => s.id === student.sectionId)?.name || "—";
                  const statusColor = student.approved === true ? "text-emerald-600 dark:text-emerald-400" : student.approved === false ? "text-rose-500 dark:text-rose-400" : "text-amber-500 dark:text-amber-400";
                  const statusLabel = student.approved === true ? "Approved" : student.approved === false ? "Rejected" : "Pending";
                  return (
                    <motion.div
                      key={student.uid}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.04 }}
                      whileHover={{ y: -3, boxShadow: "0 6px 20px rgba(0,0,0,0.09)", transition: { duration: 0.14 } }}
                      className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 shadow-sm overflow-hidden"
                    >
                      <div className={cn("h-1.5", att.totalClasses === 0 ? "bg-neutral-200 dark:bg-neutral-800" : att.percentage >= 75 ? "bg-emerald-400" : att.percentage >= 50 ? "bg-amber-400" : "bg-rose-400")} />
                      <div className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{student.name || "—"}</p>
                            <p className="text-xs text-neutral-500 font-mono truncate">{student.regNo || "—"}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={cn("text-[10px] font-semibold", statusColor)}>{statusLabel}</span>
                            <button
                              type="button"
                              title="Edit student details"
                              onClick={() => {
                                setEditStudentUid(student.uid);
                                setEditName(student.name || "");
                                setEditRegNo(student.regNo || "");
                                setEditBranch(student.branch || "");
                                setEditPhone(student.phone || "");
                                setEditSectionId(student.sectionId || "");
                              }}
                              className="ml-1 p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <div><span className="text-neutral-400">Email</span><p className="truncate text-neutral-700 dark:text-neutral-300">{student.email}</p></div>
                          <div><span className="text-neutral-400">Phone</span><p className="truncate text-neutral-700 dark:text-neutral-300">{student.phone || "—"}</p></div>
                          <div><span className="text-neutral-400">Branch</span><p className="truncate text-neutral-700 dark:text-neutral-300">{student.branch || "—"}</p></div>
                          <div><span className="text-neutral-400">Section</span><p className="truncate text-neutral-700 dark:text-neutral-300">{secName}</p></div>
                        </div>
                        {student.approved === true && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-neutral-400">Attendance</span>
                              <span className={cn("text-xs font-bold", att.percentage >= 75 ? "text-emerald-600" : att.percentage >= 50 ? "text-amber-600" : "text-rose-600")}>
                                {att.totalClasses > 0 ? `${att.percentage}%` : "N/A"}
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                              <div
                                className={cn("h-full rounded-full transition-all", att.percentage >= 75 ? "bg-emerald-400" : att.percentage >= 50 ? "bg-amber-400" : "bg-rose-400")}
                                style={{ width: att.totalClasses > 0 ? `${Math.min(att.percentage, 100)}%` : "0%" }}
                              />
                            </div>
                            <p className="text-[10px] text-neutral-400 mt-0.5">{att.totalAttended}/{att.totalClasses} classes</p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
            </div>
          )}
        </motion.section>
        )}

        {/* ─── TIMETABLE SECTION ─── */}
        {currentSection === "timetable" && (
        <motion.section
          id="timetable"
          key="timetable"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          <h2 className="text-xl font-bold mb-4 sm:text-2xl">Timetable Management</h2>

        {/* Two-column layout on desktop, stacked on mobile */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Subjects Section */}
          <Card elevation={3}>
            <CardHeader>
              <CardTitle>Subjects</CardTitle>
              <CardDescription>Manage course subjects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleAddSubject} className="flex gap-2">
                <Input
                  placeholder="Subject name"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  disabled={isAddingSubject}
                />
                <Button type="submit" disabled={isAddingSubject || !subjectName.trim()}>
                  {isAddingSubject ? "Adding..." : "Add"}
                </Button>
              </form>

              <div className="space-y-2">
                {subjects.length === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No subjects added yet.
                  </p>
                ) : (
                  subjects.map((subject) => (
                    <div
                      key={subject.id}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                    >
                      <span className="text-sm font-medium">{subject.name}</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteSubject(subject.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Periods Section */}
          <Card elevation={3}>
            <CardHeader>
              <CardTitle>Periods</CardTitle>
              <CardDescription>Manage class periods</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleAddPeriod} className="flex gap-2">
                <Input
                  placeholder="Period label"
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  disabled={isAddingPeriod}
                />
                <Button type="submit" disabled={isAddingPeriod || !periodLabel.trim()}>
                  {isAddingPeriod ? "Adding..." : "Add"}
                </Button>
              </form>

              <div className="space-y-2">
                {periods.length === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No periods added yet.
                  </p>
                ) : (
                  periods.map((period) => (
                    <div
                      key={period.id}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                    >
                      <span className="text-sm font-medium">{period.label}</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeletePeriod(period.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sections Management */}
        <Card elevation={3}>
          <CardHeader>
            <CardTitle>Sections</CardTitle>
            <CardDescription>Manage class sections (e.g., CSE-A, CSE-B)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleAddSection} className="flex gap-2">
              <Input
                placeholder="Section name (e.g., CSE-A)"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                disabled={isAddingSection}
              />
              <Button type="submit" disabled={isAddingSection || !sectionName.trim()}>
                {isAddingSection ? "Adding..." : "Add"}
              </Button>
            </form>

            <div className="space-y-2">
              {sections.length === 0 ? (
                <p className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-4">
                  No sections yet
                </p>
              ) : (
                sections.map((section) => (
                  <div
                    key={section.id}
                    className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${section.active ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                      <span className="text-sm font-medium">{section.name}</span>
                      <span className="text-xs text-neutral-500">
                        {section.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleSection(section.id, section.active)}
                      >
                        {section.active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteSection(section.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Timetable Management */}
        <Card elevation={3}>
          <CardHeader>
            <CardTitle>Weekly Timetable</CardTitle>
            <CardDescription>
              Manage the class schedule. Select a section, then add or delete entries.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Section selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                Section
              </label>
              <Select value={viewSection} onValueChange={setViewSection}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {sections.filter(s => s.active).map(section => (
                    <SelectItem key={section.id} value={sectionNameToLetter(section.name)}>
                      {section.name}
                    </SelectItem>
                  ))}
                  {Object.keys(timetable)
                    .filter(letter => !sections.some(s => sectionNameToLetter(s.name) === letter))
                    .map(letter => (
                      <SelectItem key={letter} value={letter}>
                        Section {letter}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Add entry form — only when a section is selected */}
            {viewSection && (
              <form onSubmit={handleAddSlot} className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Add Timetable Entry — Section {viewSection}</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Day</label>
                    <Select value={newSlotDay} onValueChange={setNewSlotDay} disabled={isAddingSlot}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WEEKDAYS.map(d => (
                          <SelectItem key={d} value={d.toLowerCase()}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Subject</label>
                    <Input
                      placeholder="e.g. DBMS"
                      value={newSlotSubject}
                      onChange={e => setNewSlotSubject(e.target.value)}
                      disabled={isAddingSlot}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Start Time</label>
                    <Input type="time" value={newSlotStart} onChange={e => setNewSlotStart(e.target.value)} disabled={isAddingSlot} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">End Time</label>
                    <Input type="time" value={newSlotEnd} onChange={e => setNewSlotEnd(e.target.value)} disabled={isAddingSlot} />
                  </div>
                  <div className="flex flex-col justify-end space-y-2">
                    {previewClassCount > 0 && (
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                        = {previewClassCount} class{previewClassCount > 1 ? 'es' : ''}
                      </p>
                    )}
                    <Button
                      type="submit"
                      disabled={isAddingSlot || !newSlotSubject.trim() || !newSlotStart || !newSlotEnd || previewClassCount <= 0}
                      className="w-full"
                    >
                      {isAddingSlot ? "Adding..." : "Add Entry"}
                    </Button>
                  </div>
                </div>
              </form>
            )}

            {/* Day-wise timetable with delete buttons */}
            {viewSection && timetable[viewSection] ? (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Schedule for Section {viewSection}
                </h3>
                {WEEKDAYS.map(day => {
                  const dayKey = day.toLowerCase();
                  const daySlots = timetable[viewSection]?.[dayKey] || [];
                  const sorted = [...daySlots].sort((a, b) => a.start.localeCompare(b.start));

                  return (
                    <div key={day} className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                      <h4 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                        {day}
                        <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                          ({sorted.length} entr{sorted.length === 1 ? 'y' : 'ies'})
                        </span>
                      </h4>
                      {sorted.length === 0 ? (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">No classes scheduled</p>
                      ) : (
                        <div className="space-y-2">
                          {sorted.map((slot, idx) => {
                            // Find the original index in the unsorted array for deletion
                            const origIdx = daySlots.findIndex(
                              s => s.subject === slot.subject && s.start === slot.start && s.end === slot.end
                            );
                            const delKey = `${dayKey}-${origIdx}`;
                            const slotKey = `${dayKey}-${origIdx}`;
                            const isEditing = editSlotKey === slotKey;
                            return (
                              <div
                                key={`${day}-${idx}`}
                                className="rounded border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 overflow-hidden"
                              >
                                {/* Row */}
                                <div className="flex items-center justify-between p-2">
                                  <div className="flex items-center gap-3">
                                    <Clock className="h-4 w-4 shrink-0 text-neutral-500" />
                                    <div>
                                      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                                        {slot.subject}
                                      </p>
                                      <p className="text-xs text-neutral-600 dark:text-neutral-400">
                                        {slot.start} – {slot.end}
                                        <span className="ml-2 text-blue-600 dark:text-blue-400">
                                          ({slot.classCount} class{slot.classCount > 1 ? 'es' : ''})
                                        </span>
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-neutral-500 hover:text-blue-600"
                                      onClick={() => {
                                        if (isEditing) {
                                          setEditSlotKey(null);
                                        } else {
                                          setEditSlotKey(slotKey);
                                          setEditSlotSubject(slot.subject);
                                          setEditSlotStart(slot.start);
                                          setEditSlotEnd(slot.end);
                                        }
                                      }}
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-7 w-7 p-0"
                                      disabled={isDeletingSlot === delKey}
                                      onClick={() => handleDeleteSlot(dayKey, origIdx)}
                                    >
                                      {isDeletingSlot === delKey ? (
                                        <LoadingSpinner size="sm" />
                                      ) : (
                                        <Trash2 className="h-3 w-3" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                                {/* Inline edit form */}
                                {isEditing && (
                                  <div className="border-t border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 p-3 space-y-2">
                                    <input
                                      type="text"
                                      value={editSlotSubject}
                                      onChange={e => setEditSlotSubject(e.target.value)}
                                      placeholder="Subject name"
                                      className="w-full rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <div className="flex gap-2">
                                      <div className="flex-1 space-y-0.5">
                                        <p className="text-[10px] text-neutral-500">Start</p>
                                        <input
                                          type="time"
                                          value={editSlotStart}
                                          onChange={e => setEditSlotStart(e.target.value)}
                                          className="w-full rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div className="flex-1 space-y-0.5">
                                        <p className="text-[10px] text-neutral-500">End</p>
                                        <input
                                          type="time"
                                          value={editSlotEnd}
                                          onChange={e => setEditSlotEnd(e.target.value)}
                                          className="w-full rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                    </div>
                                    <div className="flex gap-2 pt-1">
                                      <Button
                                        size="sm"
                                        className="flex-1"
                                        disabled={isSavingSlot || !editSlotSubject.trim() || !editSlotStart || !editSlotEnd}
                                        onClick={() => handleSaveSlot(dayKey, origIdx)}
                                      >
                                        {isSavingSlot ? <LoadingSpinner size="sm" /> : <><Check className="h-3 w-3 mr-1" />Save</>}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="flex-1"
                                        onClick={() => setEditSlotKey(null)}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : viewSection ? (
              <p className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-4">
                No timetable data for Section {viewSection} yet. Use the form above to add entries.
              </p>
            ) : (
              <p className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-4">
                {Object.keys(timetable).length > 0
                  ? `Timetable loaded for sections: ${Object.keys(timetable).join(", ")}. Select a section above to manage.`
                  : "No timetable data yet. Select a section and add entries above."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Holiday Management */}
        <Card elevation={3}>
          <CardHeader>
            <CardTitle>Holiday Management</CardTitle>
            <CardDescription>
              Mark specific dates as holidays. Students cannot mark attendance on these dates.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleAddHoliday} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Select Date
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {holidayDate ? format(holidayDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={holidayDate}
                        onSelect={setHolidayDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Reason
                  </label>
                  <Input
                    placeholder="e.g., National Holiday"
                    value={holidayReason}
                    onChange={(e) => setHolidayReason(e.target.value)}
                    disabled={isAddingHoliday}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isAddingHoliday || !holidayDate || !holidayReason.trim()}
              >
                {isAddingHoliday ? "Adding..." : "Mark as Holiday"}
              </Button>
            </form>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Marked Holidays ({holidays.length})
              </h3>
              {holidays.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No holidays marked yet.
                </p>
              ) : (
                <div className="max-h-60 space-y-2 overflow-y-auto">
                  {holidays.map((holiday) => (
                    <div
                      key={holiday.date}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {format(new Date(holiday.date), "EEEE, MMMM d, yyyy")}
                        </p>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400">
                          {holiday.reason}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteHoliday(holiday.date)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        </motion.section>
        )}

        {/* ─── DANGER ZONE SECTION ─── */}
        {currentSection === "settings" && (
        <motion.section
          id="settings"
          key="settings"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          <h2 className="text-xl font-bold mb-4 sm:text-2xl">Settings & Danger Zone</h2>
        
        {/* Semester Reset - Danger Zone */}
        <Card elevation={4} className="border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
            <CardDescription>
              Irreversible actions. Use with extreme caution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showResetConfirm ? (
              <div className="space-y-2">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Start New Semester</AlertTitle>
                  <AlertDescription>
                    This will permanently delete:
                    <ul className="mt-2 list-inside list-disc space-y-1">
                      <li>All attendance records</li>
                      <li>All holiday entries</li>
                      <li>All subjects and periods</li>
                      <li>All initial attendance data</li>
                    </ul>
                    <p className="mt-2 font-semibold">User accounts will be preserved.</p>
                  </AlertDescription>
                </Alert>
                <Button
                  variant="destructive"
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Start New Semester
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Confirm Semester Reset</AlertTitle>
                  <AlertDescription>
                    Type <strong>RESET</strong> to confirm this action. This cannot be undone.
                  </AlertDescription>
                </Alert>
                <Input
                  placeholder="Type RESET to confirm"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  disabled={isResetting}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowResetConfirm(false);
                      setResetConfirmText("");
                    }}
                    disabled={isResetting}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleSemesterReset}
                    disabled={isResetting || resetConfirmText !== "RESET"}
                    className="flex-1"
                  >
                    {isResetting ? "Resetting..." : "Confirm Reset"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        </motion.section>
        )}

        </AnimatePresence>

        {/* ─── EDIT STUDENT MODAL ─── */}
        {editStudentUid && (() => {
          const student = students.find(s => s.uid === editStudentUid);
          if (!student) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <Card elevation={4} className="w-full max-w-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Pencil className="h-4 w-4" /> Edit Student Details
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">{student.email}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 col-span-2">
                      <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Full Name</label>
                      <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Full name" disabled={isSavingEdit} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Reg No</label>
                      <Input value={editRegNo} onChange={e => setEditRegNo(e.target.value)} placeholder="Reg number" disabled={isSavingEdit} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Phone</label>
                      <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="Phone" disabled={isSavingEdit} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Branch</label>
                      <Input value={editBranch} onChange={e => setEditBranch(e.target.value)} placeholder="Branch" disabled={isSavingEdit} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Section</label>
                      <select
                        value={editSectionId}
                        onChange={e => setEditSectionId(e.target.value)}
                        disabled={isSavingEdit}
                        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                      >
                        <option value="">— No section —</option>
                        {sections.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1" onClick={() => setEditStudentUid(null)} disabled={isSavingEdit}>Cancel</Button>
                    <Button className="flex-1" onClick={handleSaveEdit} disabled={isSavingEdit || !editName.trim()}>
                      {isSavingEdit ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })()}

        {/* ─── DELETE USER CONFIRMATION MODAL ─── */}
        {deleteUserUid && (() => {
          const studentToDelete = students.find(s => s.uid === deleteUserUid);
          if (!studentToDelete) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <Card elevation={4} className="w-full max-w-md border-red-200 dark:border-red-800">
                <CardHeader>
                  <CardTitle className="text-red-600 dark:text-red-400 flex items-center gap-2">
                    <UserX className="h-5 w-5" />
                    Delete User
                  </CardTitle>
                  <CardDescription>
                    This will permanently delete the user and all their attendance data.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                    <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                      {studentToDelete.name || "No Name"}
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 font-mono">
                      {studentToDelete.regNo || studentToDelete.email}
                    </p>
                  </div>
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Type <strong>DELETE</strong> to confirm. This cannot be undone.
                    </AlertDescription>
                  </Alert>
                  <Input
                    placeholder="Type DELETE to confirm"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    disabled={isDeletingUser}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDeleteUserUid(null);
                        setDeleteConfirmText("");
                      }}
                      disabled={isDeletingUser}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteUser}
                      disabled={isDeletingUser || deleteConfirmText !== "DELETE"}
                      className="flex-1"
                    >
                      {isDeletingUser ? "Deleting..." : "Delete User"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })()}

              </div>
            </main>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
