"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, doc, setDoc, getDoc, updateDoc, deleteField, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ADMIN_EMAIL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { PageTransition } from "@/components/page-transition";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Collapsible } from "@/components/ui/collapsible";
import { CalendarIcon, Info, LogOut, AlertTriangle, CheckCircle, XCircle, LayoutDashboard, BookOpen, Menu, X, TrendingUp, CalendarDays, Sun, Moon, MessageCircle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer,
} from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { format, startOfWeek, subWeeks, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

interface AttendanceRecord {
  subjectId: string;   // now stores subject NAME (e.g. "DBMS")
  status: "PRESENT" | "ABSENT";
  timestamp: number;
  classCount: number;
}

interface PeriodAttendance {
  [entryKey: string]: AttendanceRecord;
}

interface InitialAttendance {
  attended: number;
  total: number;
  uptoDate: string;
}

// ─── NEW TIMETABLE SCHEMA ───
interface TimetableSlot {
  subject: string;
  start: string;   // HH:mm
  end: string;      // HH:mm
  classCount: number;
}

type SectionTimetable = Record<string, TimetableSlot[]>; // day → slots

// Map section Firestore doc IDs to timetable section letters
function sectionNameToLetter(sectionName: string): string {
  const parts = sectionName.split("-");
  return parts[parts.length - 1].toUpperCase();
}

export default function StudentPage() {
  const router = useRouter();
  const { user, role, loading, profileLoading } = useAuth();

  const [sectionTimetable, setSectionTimetable] = useState<SectionTimetable>({});
  const [slotsForDate, setSlotsForDate] = useState<TimetableSlot[]>([]);
  const [attendance, setAttendance] = useState<PeriodAttendance>({});
  const [submitting, setSubmitting] = useState<{ [key: string]: boolean }>({});
  const [initialAttendance, setInitialAttendance] = useState<InitialAttendance | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [appAttended, setAppAttended] = useState(0);
  const [appTotal, setAppTotal] = useState(0);
  const [allAttendanceDates, setAllAttendanceDates] = useState<Set<string>>(new Set());
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [holidayReasons, setHolidayReasons] = useState<Map<string, string>>(new Map());
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [sectionLetter, setSectionLetter] = useState<string>("");
  const [pageLoading, setPageLoading] = useState(true);
  const [allowFutureAttendance, setAllowFutureAttendance] = useState<boolean>(false);
  const [allowBackdatedAttendance, setAllowBackdatedAttendance] = useState<boolean>(false);
  const [userName, setUserName] = useState<string>("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState("overview");

  type AnalysisFilter = "all" | "monthly" | "daily";
  const [rawDateRecords, setRawDateRecords] = useState<Record<string, Record<string, AttendanceRecord>>>({});
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>("all");
  const [isDark, setIsDark] = useState(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState<"PRESENT" | "ABSENT" | null>(null);
  const toast = useToast();

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

  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");
  const isToday = selectedDateStr === today;

  useEffect(() => {
    if (loading || profileLoading) return;

    if (!user) {
      router.replace("/login");
    } else if (role === "admin") {
      router.replace("/admin");
    } else if (role !== "student") {
      router.replace("/pending-approval");
    }
  }, [user, role, loading, profileLoading, router]);

  // Check approval, section, backdated permission, and initial attendance (real-time)
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(doc(db, "users", user.uid), async (docSnap) => {
      if (!docSnap.exists()) {
        router.push("/pending-approval");
        return;
      }

      const data = docSnap.data();

      if (!data.sectionId) {
        router.push("/pending-approval");
        return;
      }

      const approved = data.approved === true;
      setIsApproved(approved);

      if (!approved) {
        router.push("/pending-approval");
        return;
      }

      if (data.initialAttendance) {
        setInitialAttendance(data.initialAttendance);
      }

      // Set user name and permissions
      setUserName(data.name || "");
      setAllowFutureAttendance(data.allowFutureAttendance === true);
      setAllowBackdatedAttendance(data.allowBackdatedAttendance === true);

      // Resolve section letter from sections collection
      const sectionDoc = await getDoc(doc(db, "sections", data.sectionId));
      if (sectionDoc.exists()) {
        const secName = sectionDoc.data().name || "";
        setSectionLetter(sectionNameToLetter(secName));
      }

      setPageLoading(false);
    });

    return () => unsubscribe();
  }, [user, router]);

  // Calculate app-based attendance (real-time)
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(collection(db, "attendance", user.uid, "dates"), (snapshot) => {
      let attended = 0, total = 0;
      const dates = new Set<string>();
      const raw: Record<string, Record<string, AttendanceRecord>> = {};

      snapshot.forEach((dateDoc) => {
        const dateStr = dateDoc.id;
        const data = dateDoc.data() as PeriodAttendance;
        const records = Object.values(data);
        if (records.length > 0) { dates.add(dateStr); raw[dateStr] = data as Record<string, AttendanceRecord>; }
        records.forEach((record) => {
          const count = record.classCount || 1;
          total += count;
          if (record.status === "PRESENT") attended += count;
        });
      });

      setAppAttended(attended);
      setAppTotal(total);
      setAllAttendanceDates(dates);
      setRawDateRecords(raw);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to full section timetable from Firestore doc
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL || !sectionLetter) return;

    const timetableDocRef = doc(db, "timetable", "CSE-DS");
    const unsubscribe = onSnapshot(timetableDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const sections = data.sections || {};
        const sectionData: SectionTimetable = sections[sectionLetter] || {};
        setSectionTimetable(sectionData);
      } else {
        setSectionTimetable({});
      }
    });

    return () => unsubscribe();
  }, [user, sectionLetter]);

  // Derive slots for selected date from stored timetable
  useEffect(() => {
    const dayKey = format(selectedDate, "EEEE").toLowerCase();
    const slots: TimetableSlot[] = (sectionTimetable[dayKey] || [])
      .sort((a: TimetableSlot, b: TimetableSlot) => a.start.localeCompare(b.start));
    setSlotsForDate(slots);
  }, [selectedDate, sectionTimetable]);

  // Listen to holidays collection
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(collection(db, "holidays"), (snapshot) => {
      const holidayDates = new Set<string>();
      const holidayMap = new Map<string, string>();
      
      snapshot.forEach(doc => {
        holidayDates.add(doc.id);
        holidayMap.set(doc.id, doc.data().reason);
      });
      
      setHolidays(holidayDates);
      setHolidayReasons(holidayMap);
    });

    return () => unsubscribe();
  }, [user]);

  // Load attendance for selected date
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const loadAttendance = async () => {
      const attendanceDoc = doc(db, "attendance", user.uid, "dates", selectedDateStr);
      const docSnap = await getDoc(attendanceDoc);
      
      if (docSnap.exists()) {
        setAttendance(docSnap.data() as PeriodAttendance);
      } else {
        setAttendance({});
      }
    };

    loadAttendance();
  }, [user, selectedDateStr]);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const handleUnmarkAttendance = async (slotKey: string) => {
    if (!user) return;
    const prevAttendance = attendance;
    const newAttendance = { ...attendance };
    delete newAttendance[slotKey];
    const prevDates = new Set(allAttendanceDates);
    setAttendance(newAttendance);
    if (Object.keys(newAttendance).length === 0) {
      setAllAttendanceDates((prev) => {
        const next = new Set(prev);
        next.delete(selectedDateStr);
        return next;
      });
    }
    setSubmitting((prev) => ({ ...prev, [slotKey]: true }));

    try {
      const attendanceDoc = doc(db, "attendance", user.uid, "dates", selectedDateStr);
      await updateDoc(attendanceDoc, { [slotKey]: deleteField() });

      if (Object.keys(newAttendance).length === 0) {
        await deleteDoc(attendanceDoc);
      }
    } catch (error) {
      console.error("Error unmarking attendance:", error);
      setAttendance(prevAttendance);
      setAllAttendanceDates(prevDates);
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting((prev) => ({ ...prev, [slotKey]: false }));
    }
  };

  const handleMarkAttendance = async (slotKey: string, slot: TimetableSlot, status: "PRESENT" | "ABSENT") => {
    if (!user) return;

    // If same status clicked again → unmark (toggle off)
    if (attendance[slotKey]?.status === status) {
      await handleUnmarkAttendance(slotKey);
      return;
    }

    // Validate date
    if (selectedDateStr > today && !allowFutureAttendance) {
      toast.warning("Cannot mark attendance for future dates.");
      return;
    }
    // Limit to 7 days ahead
    if (selectedDateStr > today && allowFutureAttendance) {
      const maxFutureDate = new Date();
      maxFutureDate.setDate(maxFutureDate.getDate() + 7);
      if (new Date(selectedDateStr) > maxFutureDate) {
        toast.warning("Cannot mark attendance more than 7 days in advance.");
        return;
      }
    }
    if (holidays.has(selectedDateStr)) {
      toast.warning("Cannot mark attendance on a holiday.");
      return;
    }

    // Optimistic update — show result immediately
    const record: AttendanceRecord = {
      subjectId: slot.subject,
      status,
      timestamp: Date.now(),
      classCount: slot.classCount || 1,
    };
    const prevAttendance = attendance;
    const prevDates = new Set(allAttendanceDates);
    setAttendance((prev) => ({ ...prev, [slotKey]: record }));
    setAllAttendanceDates((prev) => {
      const next = new Set(prev);
      next.add(selectedDateStr);
      return next;
    });
    setSubmitting((prev) => ({ ...prev, [slotKey]: true }));

    try {
      const attendanceDoc = doc(db, "attendance", user.uid, "dates", selectedDateStr);
      await setDoc(attendanceDoc, { [slotKey]: record }, { merge: true });
    } catch (error) {
      console.error("Error marking attendance:", error);
      // Revert optimistic update on failure
      setAttendance(prevAttendance);
      setAllAttendanceDates(prevDates);
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting((prev) => ({ ...prev, [slotKey]: false }));
    }
  };

  const handleMarkAllDay = async (status: "PRESENT" | "ABSENT") => {
    if (!user || slotsForDate.length === 0) return;

    if (selectedDateStr > today && !allowFutureAttendance) {
      toast.warning("Cannot mark attendance for future dates.");
      return;
    }
    if (selectedDateStr > today && allowFutureAttendance) {
      const maxFutureDate = new Date();
      maxFutureDate.setDate(maxFutureDate.getDate() + 7);
      if (new Date(selectedDateStr) > maxFutureDate) {
        toast.warning("Cannot mark attendance more than 7 days in advance.");
        return;
      }
    }
    if (holidays.has(selectedDateStr)) {
      toast.warning("Cannot mark attendance on a holiday.");
      return;
    }

    setIsBulkSubmitting(status);
    const now = Date.now();
    const newRecords: PeriodAttendance = {};
    for (const slot of slotsForDate) {
      const slotKey = `${slot.subject}_${slot.start}_${slot.end}`;
      newRecords[slotKey] = {
        subjectId: slot.subject,
        status,
        timestamp: now,
        classCount: slot.classCount || 1,
      };
    }

    const prevAttendance = attendance;
    const prevDates = new Set(allAttendanceDates);
    setAttendance((prev) => ({ ...prev, ...newRecords }));
    setAllAttendanceDates((prev) => {
      const next = new Set(prev);
      next.add(selectedDateStr);
      return next;
    });

    try {
      const attendanceDoc = doc(db, "attendance", user.uid, "dates", selectedDateStr);
      await setDoc(attendanceDoc, newRecords, { merge: true });
    } catch (error) {
      console.error("Error bulk marking attendance:", error);
      setAttendance(prevAttendance);
      setAllAttendanceDates(prevDates);
      toast.error("Network error. Please try again.");
    } finally {
      setIsBulkSubmitting(null);
    }
  };

  // Date validation
  const cutoffDate = initialAttendance ? new Date(initialAttendance.uptoDate) : null;
  const isDateDisabled = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    // Future dates disabled UNLESS allowFutureAttendance is true
    if (dateStr > today && !allowFutureAttendance) return true;
    // Limit future dates to 7 days ahead even with permission
    if (dateStr > today && allowFutureAttendance) {
      const maxFutureDate = new Date();
      maxFutureDate.setDate(maxFutureDate.getDate() + 7);
      if (date > maxFutureDate) return true;
    }
    // Dates on or before cutoff disabled
    if (cutoffDate && dateStr <= format(cutoffDate, "yyyy-MM-dd")) return true;
    // Holidays disabled
    if (holidays.has(dateStr)) return true;
    // Sundays disabled
    if (date.getDay() === 0) return true;
    return false;
  };

  // ─── CALENDAR MODIFIERS: green = marked, red = missed ───
  const { markedDates, missedDates } = useMemo(() => {
    const marked: Date[] = [];
    const missed: Date[] = [];

    const cutoffStr = cutoffDate ? format(cutoffDate, "yyyy-MM-dd") : null;
    // Start from 60 days ago or cutoff date, whichever is later - keeps list manageable
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 90);
    if (cutoffDate && cutoffDate > rangeStart) {
      rangeStart.setTime(cutoffDate.getTime() + 86400000);
    }

    const rangeEnd = new Date(); // today
    let current = new Date(rangeStart);

    while (current <= rangeEnd) {
      const dateStr = format(current, "yyyy-MM-dd");
      // Skip if before/on cutoff, holiday, or Sunday
      if (cutoffStr && dateStr <= cutoffStr) { current = new Date(current.getTime() + 86400000); continue; }
      if (holidays.has(dateStr)) { current = new Date(current.getTime() + 86400000); continue; }
      if (current.getDay() === 0) { current = new Date(current.getTime() + 86400000); continue; }

      // Check if there are classes for this day in the timetable
      const dayKey = format(current, "EEEE").toLowerCase();
      const slots = sectionTimetable[dayKey] || [];

      if (slots.length > 0) {
        if (allAttendanceDates.has(dateStr)) {
          marked.push(new Date(current));
        } else {
          missed.push(new Date(current));
        }
      }
      current = new Date(current.getTime() + 86400000);
    }

    return { markedDates: marked, missedDates: missed };
  }, [cutoffDate, holidays, sectionTimetable, allAttendanceDates, today]);

  // ─── Analysis: filtered stats (derived from rawDateRecords + analysisFilter) ───
  const analysisFilteredRecords = useMemo(() => {
    const today = new Date();
    if (analysisFilter === "daily") {
      const todayStr = format(today, "yyyy-MM-dd");
      return Object.fromEntries(Object.entries(rawDateRecords).filter(([d]) => d === todayStr));
    }
    if (analysisFilter === "monthly") {
      const prefix = format(today, "yyyy-MM");
      return Object.fromEntries(Object.entries(rawDateRecords).filter(([d]) => d.startsWith(prefix)));
    }
    return rawDateRecords;
  }, [rawDateRecords, analysisFilter]);

  const analysisSubjectStats = useMemo(() => {
    const sm: Record<string, { p: number; a: number }> = {};
    Object.values(analysisFilteredRecords).forEach((slots) =>
      Object.values(slots).forEach((r) => {
        const c = r.classCount || 1;
        if (!sm[r.subjectId]) sm[r.subjectId] = { p: 0, a: 0 };
        r.status === "PRESENT" ? (sm[r.subjectId].p += c) : (sm[r.subjectId].a += c);
      })
    );
    return Object.entries(sm)
      .map(([subject, { p, a }]) => ({ subject, present: p, absent: a, total: p + a, percentage: p + a > 0 ? Math.round((p / (p + a)) * 100) : 0 }))
      .sort((a, b) => b.percentage - a.percentage);
  }, [analysisFilteredRecords]);

  const analysisTrendData = useMemo(() => {
    const today = new Date();
    const sumSlots = (slots: Record<string, AttendanceRecord>) => {
      let p = 0, a = 0;
      Object.values(slots).forEach((r) => { const c = r.classCount || 1; r.status === "PRESENT" ? (p += c) : (a += c); });
      return { p, a };
    };
    if (analysisFilter === "daily") {
      const todayStr = format(today, "yyyy-MM-dd");
      const todayData = rawDateRecords[todayStr] || {};
      return Object.entries(todayData).map(([key, r]) => ({
        label: r.subjectId || key,
        present: r.status === "PRESENT" ? (r.classCount || 1) : 0,
        absent: r.status === "ABSENT" ? (r.classCount || 1) : 0,
        total: r.classCount || 1,
      }));
    }
    if (analysisFilter === "monthly") {
      const days = eachDayOfInterval({ start: startOfMonth(today), end: endOfMonth(today) });
      const buckets: { label: string; present: number; absent: number; total: number }[] = [];
      for (let i = 0; i < days.length; i += 5) {
        const chunk = days.slice(i, i + 5);
        let p = 0, a = 0;
        chunk.forEach((day) => { const s = sumSlots(rawDateRecords[format(day, "yyyy-MM-dd")] || {}); p += s.p; a += s.a; });
        buckets.push({ label: format(chunk[0], "d MMM"), present: p, absent: a, total: p + a });
      }
      return buckets;
    }
    return Array.from({ length: 12 }, (_, i) => {
      const ws = startOfWeek(subWeeks(today, 11 - i), { weekStartsOn: 1 });
      const we = new Date(ws.getTime() + 6 * 86400000);
      const wsS = format(ws, "yyyy-MM-dd"), weS = format(we, "yyyy-MM-dd");
      let p = 0, a = 0;
      Object.entries(rawDateRecords).filter(([d]) => d >= wsS && d <= weS)
        .forEach(([, slots]) => { const s = sumSlots(slots); p += s.p; a += s.a; });
      return { label: format(ws, "d MMM"), present: p, absent: a, total: p + a };
    });
  }, [rawDateRecords, analysisFilter]);

  const analysisFiltAtt = useMemo(() => {
    let att = 0, tot = 0;
    Object.values(analysisFilteredRecords).forEach((slots) =>
      Object.values(slots).forEach((r) => { const c = r.classCount || 1; tot += c; if (r.status === "PRESENT") att += c; })
    );
    return { att, tot, pct: tot > 0 ? Math.round((att / tot) * 100) : 0 };
  }, [analysisFilteredRecords]);

  if (loading || profileLoading || pageLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        {/* Sidebar skeleton */}
        <div className="hidden lg:flex w-64 flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 gap-3">
          <Skeleton className="h-8 w-36 mb-4" />
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
          <div className="mt-auto flex flex-col gap-2">
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </div>
        {/* Main content skeleton */}
        <div className="flex-1 flex flex-col">
          {/* Header skeleton */}
          <div className="h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <div className="flex items-center gap-2">
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
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
            {/* Chart skeleton */}
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
            {/* Second chart skeleton */}
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user || role === "admin") {
    return null;
  }

  if (role !== "student") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const isSelectedDateValid = !isDateDisabled(selectedDate);
  const isHoliday = holidays.has(selectedDateStr);
  const isSunday = selectedDate.getDay() === 0;
  const isPastDate = selectedDateStr < today;
  const isFutureDate = selectedDateStr > today;
  const selectedDayName = format(selectedDate, "EEEE");

  // ─── UNIFIED ATTENDANCE FORMULA ───
  // totalAttended = initialAttendedClasses + appAttendedClasses
  // totalClasses  = initialTotalClasses   + appTotalClasses
  // percentage    = totalClasses > 0 ? (totalAttended / totalClasses) * 100 : 0
  const totalAttended = (initialAttendance?.attended ?? 0) + appAttended;
  const totalClasses = (initialAttendance?.total ?? 0) + appTotal;
  const overallPercentage = totalClasses > 0 ? Math.round(((totalAttended / totalClasses) * 100) * 100) / 100 : 0;
  const initialPercentage = initialAttendance && initialAttendance.total > 0
    ? Math.round(((initialAttendance.attended / initialAttendance.total) * 100) * 100) / 100
    : 0;
  const appPercentage = appTotal > 0 ? Math.round(((appAttended / appTotal) * 100) * 100) / 100 : 0;

  const subjectChartConfig = {
    percentage: { label: "Attendance %", color: "#4f46e5" },
    present:    { label: "Present",      color: "#4f46e5" },
    absent:     { label: "Absent",       color: "#e2e8f0" },
  };
  const trendChartConfig = {
    present: { label: "Present", color: "#4f46e5" },
    absent:  { label: "Absent",  color: "#cbd5e1" },
  };
  const analysisTabs = [
    { key: "all"     as AnalysisFilter, label: "All Time"   },
    { key: "monthly" as AnalysisFilter, label: "This Month" },
    { key: "daily"   as AnalysisFilter, label: "Today"      },
  ];
  const donutClr = overallPercentage >= 75 ? "#4f46e5" : overallPercentage >= 50 ? "#d97706" : "#dc2626";

  const menuItems = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "attendance", label: "Mark Attendance", icon: BookOpen },
    { id: "analysis", label: "Analysis", icon: TrendingUp },
  ];

  return (
    <PageTransition>
      <div className="min-h-screen page-background">
        {/* ─── TOP NAVIGATION BAR ─── */}
        <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-neutral-800 dark:bg-neutral-950/95">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
              <h1 className="text-lg font-bold">Attendance</h1>
              {allowFutureAttendance && (
                <Badge variant="warning" className="hidden sm:inline-flex">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Future Enabled
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex flex-col items-end leading-tight">
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 max-w-[140px] truncate">
                  {userName || user.email?.split("@")[0]}
                </span>
                <span className="text-[10px] text-neutral-500 dark:text-neutral-400 hidden sm:block max-w-[160px] truncate">
                  {user.email}
                </span>
              </div>
              <button
                onClick={toggleTheme}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 transition-colors border border-neutral-200 dark:border-neutral-700"
                title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span className="text-xs font-medium">{isDark ? "Light" : "Dark"}</span>
              </button>
              <Button variant="outline" size="sm" onClick={handleSignOut} className="shrink-0">
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sign Out</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl">
          <div className="flex">
            {/* ─── DESKTOP SIDEBAR ─── */}
            <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-48 shrink-0 overflow-y-auto border-r border-neutral-200 p-4 dark:border-neutral-800 lg:block">
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
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
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
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                  />
                  <motion.aside
                    initial={{ x: -256 }}
                    animate={{ x: 0 }}
                    exit={{ x: -256 }}
                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    className="fixed left-0 top-14 z-50 h-[calc(100vh-3.5rem)] w-64 border-r border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 lg:hidden"
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
                              "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
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

                      {/* Back to Overview */}
                      {currentSection !== "overview" && (
                        <button
                          type="button"
                          onClick={() => { setCurrentSection("overview"); setMobileMenuOpen(false); }}
                          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50 mt-2 pt-3 border-t border-neutral-100 dark:border-neutral-800"
                        >
                          <LayoutDashboard className="h-4 w-4" />
                          Back to Overview
                        </button>
                      )}


                    </nav>
                  </motion.aside>
                </>
              )}
            </AnimatePresence>

            {/* ─── MAIN CONTENT ─── */}
            <main className="flex-1 p-4 lg:p-6">
              {/* Mobile-only context bar */}
              {currentSection !== "overview" && (
                <div className="lg:hidden mb-4">
                  <button
                    onClick={() => setCurrentSection("overview")}
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Back to Overview
                  </button>
                </div>
              )}
              <div className="space-y-6">

        {/* Future Attendance Warning */}
        {allowFutureAttendance && (
          <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="ml-7 text-sm text-amber-800 dark:text-amber-200">
              <strong>Future Attendance Enabled:</strong> You can mark attendance up to 7 days in advance. 
              This permission may be revoked at any time.
            </AlertDescription>
          </Alert>
        )}

        {/* ─── OVERVIEW SECTION ─── */}
        {currentSection === "overview" && (
        <motion.section
          id="overview"
          key="overview"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* Arc gauge + breakdown */}
          <Card elevation={2} className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base sm:text-lg">Attendance Summary</CardTitle>
            </CardHeader>
            <CardContent className="pb-5">
              {/* Circular gauge — full circle, label truly centered */}
              <div className="flex flex-col items-center mb-4">
                {(() => {
                  const pct = Math.min(overallPercentage, 100);
                  const color = pct >= 75 ? "#059669" : pct >= 50 ? "#d97706" : "#dc2626";
                  const size = 180;
                  const cx = size / 2;
                  const cy = size / 2;
                  const r = 72;
                  const circ = 2 * Math.PI * r;
                  // 270° arc starting from bottom-left (225° = 225deg from 3 o'clock = rotate 225-90=135)
                  const arcLength = circ * 0.75;
                  const filled = arcLength * (pct / 100);
                  return (
                    <div className="relative" style={{ width: size, height: size }}>
                      <svg width={size} height={size}>
                        {/* Track arc */}
                        <circle
                          cx={cx} cy={cy} r={r}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="12"
                          className="text-neutral-200 dark:text-neutral-800"
                          strokeDasharray={`${arcLength} ${circ}`}
                          strokeLinecap="round"
                          transform={`rotate(135 ${cx} ${cy})`}
                        />
                        {/* Filled arc */}
                        <motion.circle
                          cx={cx} cy={cy} r={r}
                          fill="none"
                          stroke={color}
                          strokeWidth="12"
                          strokeLinecap="round"
                          strokeDasharray={`${arcLength} ${circ}`}
                          initial={{ strokeDashoffset: arcLength }}
                          animate={{ strokeDashoffset: arcLength - filled }}
                          transition={{ duration: 1, ease: "easeOut" }}
                          transform={`rotate(135 ${cx} ${cy})`}
                        />
                      </svg>
                      {/* Centered label — absolutely positioned to the exact center of the SVG */}
                      <div
                        className="absolute inset-0 flex flex-col items-center justify-center"
                        style={{ pointerEvents: "none" }}
                      >
                        <span className="text-4xl font-extrabold leading-none" style={{ color }}>
                          {overallPercentage.toFixed(1)}
                          <span className="text-xl font-bold">%</span>
                        </span>
                        <span className="text-[11px] text-neutral-500 mt-1">{totalAttended}/{totalClasses}</span>
                      </div>
                    </div>
                  );
                })()}
                <p className={cn(
                  "text-sm font-semibold -mt-1",
                  overallPercentage >= 75 ? "text-emerald-700" : overallPercentage >= 50 ? "text-amber-700" : "text-red-700"
                )}>
                  {overallPercentage >= 75 ? "On Track" : overallPercentage >= 50 ? "Needs Improvement" : "Critical – Below 50%"}
                </p>
              </div>

              {/* Breakdown mini-stats */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 p-2.5">
                  <p className="text-[10px] text-neutral-500 mb-1">Before App</p>
                  {initialAttendance ? (
                    <>
                      <p className="text-sm font-bold">{initialAttendance.attended}/{initialAttendance.total}</p>
                      <p className="text-[10px] text-neutral-500">{initialPercentage.toFixed(1)}%</p>
                    </>
                  ) : (
                    <p className="text-xs text-neutral-400">N/A</p>
                  )}
                </div>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 p-2.5">
                  <p className="text-[10px] text-neutral-500 mb-1">Via App</p>
                  <p className="text-sm font-bold">{appAttended}/{appTotal}</p>
                  <p className="text-[10px] text-neutral-500">{appPercentage.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp banner */}
          <a
            href="https://chat.whatsapp.com/FeBe3I3kB1u8wYGf4XR3uf"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 hover:bg-green-100 transition-colors dark:border-green-900 dark:bg-green-950/40 dark:hover:bg-green-950/60"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-500">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">Join our WhatsApp Group</p>
              <p className="text-xs text-green-600 dark:text-green-400 truncate">Get updates, announcements &amp; notifications</p>
            </div>
            <span className="text-xs font-medium text-green-700 dark:text-green-400 shrink-0">Join →</span>
          </a>

          {/* New Analysis Feature Banner */}
          <button
            onClick={() => setCurrentSection("analysis")}
            className="mt-2 w-full flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 hover:bg-indigo-100 transition-colors dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50 text-left"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">✨ New: Analysis Feature Added</p>
              <p className="text-xs text-indigo-600 dark:text-indigo-400 truncate">Subject-wise charts, trend graphs &amp; attendance insights</p>
            </div>
            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 shrink-0">View →</span>
          </button>

          {/* ─── UNMARKED ATTENDANCE TICKETS ─── */}
          {missedDates.filter(d => format(d, "yyyy-MM-dd") !== today).slice(0, 5).length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Attendance not marked for {missedDates.filter(d => format(d, "yyyy-MM-dd") !== today).length} past day{missedDates.filter(d => format(d, "yyyy-MM-dd") !== today).length > 1 ? "s" : ""}
              </p>
              {missedDates
                .filter(d => format(d, "yyyy-MM-dd") !== today)
                .slice(0, 5)
                .map((missedDay) => {
                  const ds = format(missedDay, "yyyy-MM-dd");
                  return (
                    <button
                      key={ds}
                      className="w-full flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 hover:bg-red-100 transition-colors dark:border-red-900/50 dark:bg-red-950/30 dark:hover:bg-red-950/50 text-left"
                      onClick={() => {
                        setSelectedDate(new Date(ds + "T12:00:00"));
                        setTimeout(() => {
                          document.getElementById("mark-attendance-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }, 50);
                      }}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                        <AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">Attendance not marked</p>
                        <p className="text-xs text-red-600 dark:text-red-400">{format(missedDay, "EEEE, MMM d, yyyy")}</p>
                      </div>
                      <span className="text-xs font-semibold text-red-700 dark:text-red-400 shrink-0">Mark →</span>
                    </button>
                  );
                })}
              {missedDates.filter(d => format(d, "yyyy-MM-dd") !== today).length > 5 && (
                <p className="text-center text-xs text-neutral-400">
                  +{missedDates.filter(d => format(d, "yyyy-MM-dd") !== today).length - 5} more days with unmarked attendance
                </p>
              )}
            </div>
          )}

          {/* ─── MARK ATTENDANCE (inline on overview) ─── */}
          <div id="mark-attendance-section" className="mt-4">
            <h2 className="text-base sm:text-lg font-semibold mb-3">Mark Attendance</h2>

            {/* Date picker row */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Date:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 px-3 text-sm font-normal">
                      <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                      {format(selectedDate, "EEE, MMM d")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => { if (date && !isDateDisabled(date)) setSelectedDate(date); }}
                      disabled={isDateDisabled}
                      modifiers={{ marked: markedDates, missed: missedDates }}
                      initialFocus
                      className="rounded-md border-0"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {isToday ? (
                <Badge variant="success">Today</Badge>
              ) : isFutureDate && allowFutureAttendance ? (
                <Badge variant="warning"><AlertTriangle className="h-3 w-3 mr-1" />Future</Badge>
              ) : isPastDate ? (
                <Badge variant="info">{format(selectedDate, "MMM d")}</Badge>
              ) : null}
            </div>

            {/* Invalid date error */}
            {!isSelectedDateValid && (
              <Alert variant="destructive" className="mb-4">
                <Info className="h-4 w-4" />
                <AlertDescription className="ml-7 text-sm">
                  {isFutureDate && !allowFutureAttendance
                    ? "Cannot mark future dates. Contact admin for permission."
                    : isFutureDate && allowFutureAttendance
                    ? "Future attendance limited to 7 days ahead."
                    : isHoliday
                    ? `Holiday: ${holidayReasons.get(selectedDateStr) || "Holiday"}`
                    : isSunday
                    ? "Sundays are not valid."
                    : cutoffDate && selectedDateStr <= format(cutoffDate, "yyyy-MM-dd")
                    ? `Before cutoff (${format(cutoffDate, "MMM d")})`
                    : "Invalid date."}
                </AlertDescription>
              </Alert>
            )}

            {/* Period title */}
            <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-3">
              {isToday ? `Today's Classes (${selectedDayName})` : `${format(selectedDate, "MMM d")} (${selectedDayName})`}
            </p>

            {/* Period cards */}
            {!isSelectedDateValid ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <Info className="mx-auto h-10 w-10 text-neutral-400 dark:text-neutral-600 mb-3" />
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Cannot Mark Attendance</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Please select a valid date from the calendar above.</p>
                </CardContent>
              </Card>
            ) : slotsForDate.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <Info className="mx-auto h-10 w-10 text-neutral-400 dark:text-neutral-600 mb-3" />
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">No Classes Scheduled</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Your timetable shows no classes for {selectedDayName}.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-2 mb-4">
                  <button
                    onClick={() => handleMarkAllDay("PRESENT")}
                    disabled={isBulkSubmitting !== null || Object.values(submitting).some(Boolean)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 text-sm font-semibold border transition-all",
                      "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60",
                      (isBulkSubmitting !== null || Object.values(submitting).some(Boolean)) && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <CheckCircle className="h-4 w-4" />
                    {isBulkSubmitting === "PRESENT" ? "Marking..." : "Mark All Present"}
                  </button>
                  <button
                    onClick={() => handleMarkAllDay("ABSENT")}
                    disabled={isBulkSubmitting !== null || Object.values(submitting).some(Boolean)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 text-sm font-semibold border transition-all",
                      "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60",
                      (isBulkSubmitting !== null || Object.values(submitting).some(Boolean)) && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <XCircle className="h-4 w-4" />
                    {isBulkSubmitting === "ABSENT" ? "Marking..." : "Mark All Absent"}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {slotsForDate.map((slot, index) => {
                  const slotKey = `${slot.subject}_${slot.start}_${slot.end}`;
                  const isSubmitted = !!attendance[slotKey];
                  const record = attendance[slotKey];
                  return (
                    <motion.div
                      key={slotKey}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.04 }}
                      whileHover={{ y: -3, transition: { duration: 0.15 } }}
                    >
                      <Card elevation={3} className="transition-shadow hover:shadow-lg" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.07)" }}>
                        <CardHeader className="p-3 sm:p-4 pb-2">
                          <CardTitle className="text-sm sm:text-base flex flex-wrap items-center gap-1">
                            <span>{slot.start} – {slot.end}</span>
                            <span className="text-xs font-normal text-blue-600 dark:text-blue-400">({slot.classCount} class{slot.classCount > 1 ? "es" : ""})</span>
                          </CardTitle>
                          {isSubmitted && (
                            <CardDescription>
                              Marked as{" "}
                              <span className={record.status === "PRESENT" ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-rose-600 dark:text-rose-400"}>
                                {record.status}
                              </span>
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent className="p-3 sm:p-4 pt-0 space-y-2">
                          <p className="text-xs sm:text-sm font-medium text-neutral-900 dark:text-neutral-50">{slot.subject}</p>
                          {isSubmitted && (
                            <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
                              Saved at {new Date(record.timestamp).toLocaleTimeString()}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleMarkAttendance(slotKey, slot, "PRESENT")}
                              disabled={submitting[slotKey]}
                              title={record?.status === "PRESENT" ? "Click to unmark" : "Mark as Present"}
                              className={cn(
                                "flex-1 rounded-lg py-2.5 text-xs sm:text-sm font-medium border transition-all",
                                record?.status === "PRESENT"
                                  ? "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600"
                                  : "bg-white dark:bg-neutral-900 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40",
                                submitting[slotKey] && "opacity-60 cursor-not-allowed"
                              )}
                            >
                              {submitting[slotKey] ? "..." : record?.status === "PRESENT" ? "✓ Present ×" : "Present"}
                            </button>
                            <button
                              onClick={() => handleMarkAttendance(slotKey, slot, "ABSENT")}
                              disabled={submitting[slotKey]}
                              title={record?.status === "ABSENT" ? "Click to unmark" : "Mark as Absent"}
                              className={cn(
                                "flex-1 rounded-lg py-2.5 text-xs sm:text-sm font-medium border transition-all",
                                record?.status === "ABSENT"
                                  ? "bg-rose-500 border-rose-500 text-white hover:bg-rose-600 hover:border-rose-600"
                                  : "bg-white dark:bg-neutral-900 border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40",
                                submitting[slotKey] && "opacity-60 cursor-not-allowed"
                              )}
                            >
                              {submitting[slotKey] ? "..." : record?.status === "ABSENT" ? "✗ Absent ×" : "Absent"}
                            </button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
              </>
            )}
          </div>

        </motion.section>
        )}

        {/* ─── MARK ATTENDANCE SECTION (dedicated tab, mirrors overview) ─── */}
        {currentSection === "attendance" && (
        <motion.section
          id="attendance"
          key="attendance"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
        {/* Compact Date Selection */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Date:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-sm font-normal"
                >
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {format(selectedDate, "EEE, MMM d")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (date && !isDateDisabled(date)) {
                      setSelectedDate(date);
                    }
                  }}
                  disabled={isDateDisabled}
                  modifiers={{ marked: markedDates, missed: missedDates }}
                  initialFocus
                  className="rounded-md border-0"
                />
              </PopoverContent>
            </Popover>
          </div>
          
          {/* Date status badges */}
          {isToday ? (
            <Badge variant="success">Today</Badge>
          ) : isFutureDate && allowFutureAttendance ? (
            <Badge variant="warning">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Future
            </Badge>
          ) : isPastDate ? (
            <Badge variant="info">{format(selectedDate, "MMM d")}</Badge>
          ) : null}
        </div>

        {/* Error for invalid dates */}
        {!isSelectedDateValid && (
          <Alert variant="destructive" className="mb-4">
            <Info className="h-4 w-4" />
            <AlertDescription className="ml-7 text-sm">
              {isFutureDate && !allowFutureAttendance
                ? "Cannot mark future dates. Contact admin for permission."
                : isFutureDate && allowFutureAttendance
                ? "Future attendance limited to 7 days ahead."
                : isHoliday
                ? `Holiday: ${holidayReasons.get(selectedDateStr) || "Holiday"}`
                : isSunday
                ? "Sundays are not valid."
                : cutoffDate && selectedDateStr <= format(cutoffDate, "yyyy-MM-dd")
                ? `Before cutoff (${format(cutoffDate, "MMM d")})`
                : "Invalid date."}
            </AlertDescription>
          </Alert>
        )}

        {/* Period Cards */}
        <div>
          <h2 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">
            {isToday
              ? `Today's Classes (${selectedDayName})`
              : `${format(selectedDate, "MMM d")} (${selectedDayName})`}
          </h2>

          {!isSelectedDateValid ? (
            <Card>
              <CardContent className="py-8 sm:py-12 text-center">
                <Info className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-neutral-400 dark:text-neutral-600 mb-3 sm:mb-4" />
                <p className="text-sm sm:text-base font-medium text-neutral-700 dark:text-neutral-300 mb-1 sm:mb-2">
                  Cannot Mark Attendance
                </p>
                <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
                  Please select a valid date from the calendar above.
                </p>
              </CardContent>
            </Card>
          ) : slotsForDate.length === 0 ? (
            <Card>
              <CardContent className="py-8 sm:py-12 text-center">
                <Info className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-neutral-400 dark:text-neutral-600 mb-3 sm:mb-4" />
                <p className="text-sm sm:text-base font-medium text-neutral-700 dark:text-neutral-300 mb-1 sm:mb-2">
                  No Classes Scheduled
                </p>
                <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
                  Your timetable shows no classes for {selectedDayName}.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <button
                  onClick={() => handleMarkAllDay("PRESENT")}
                  disabled={isBulkSubmitting !== null || Object.values(submitting).some(Boolean)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 text-sm font-semibold border transition-all",
                    "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60",
                    (isBulkSubmitting !== null || Object.values(submitting).some(Boolean)) && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <CheckCircle className="h-4 w-4" />
                  {isBulkSubmitting === "PRESENT" ? "Marking..." : "Mark All Present"}
                </button>
                <button
                  onClick={() => handleMarkAllDay("ABSENT")}
                  disabled={isBulkSubmitting !== null || Object.values(submitting).some(Boolean)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 text-sm font-semibold border transition-all",
                    "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60",
                    (isBulkSubmitting !== null || Object.values(submitting).some(Boolean)) && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <XCircle className="h-4 w-4" />
                  {isBulkSubmitting === "ABSENT" ? "Marking..." : "Mark All Absent"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {slotsForDate.map((slot, index) => {
                const slotKey = `${slot.subject}_${slot.start}_${slot.end}`;
                const isSubmitted = !!attendance[slotKey];
                const record = attendance[slotKey];
                const fadeClass = index === 0 ? 'animate-fade-in'
                  : index === 1 ? 'animate-fade-in-delay-1'
                  : index === 2 ? 'animate-fade-in-delay-2'
                  : index === 3 ? 'animate-fade-in-delay-3'
                  : index === 4 ? 'animate-fade-in-delay-4'
                  : 'animate-fade-in-delay-5';

                return (
                  <motion.div
                    key={slotKey}
                    className={fadeClass}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.04 }}
                    whileHover={{ y: -3, transition: { duration: 0.15 } }}
                    style={{ perspective: "800px" }}
                  >
                    <Card elevation={3} className="transition-shadow hover:shadow-lg" style={{ transform: "rotateX(0.5deg)", boxShadow: "0 2px 12px rgba(0,0,0,0.07)" }}>
                      <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-3">
                        <CardTitle className="text-sm sm:text-lg flex flex-wrap items-center gap-1">
                          <span>{slot.start} – {slot.end}</span>
                          <span className="text-xs sm:text-sm font-normal text-blue-600 dark:text-blue-400">
                            ({slot.classCount} class{slot.classCount > 1 ? 'es' : ''})
                          </span>
                        </CardTitle>
                          {isSubmitted && (
                            <CardDescription>
                              Marked as{" "}
                              <span
                                className={
                                  record.status === "PRESENT"
                                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                    : "font-semibold text-rose-600 dark:text-rose-400"
                                }
                              >
                                {record.status}
                              </span>
                            </CardDescription>
                          )}
                      </CardHeader>
                      <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0 space-y-3">
                          <p className="text-xs sm:text-sm text-neutral-600 dark:text-neutral-400">
                            <span className="font-medium text-neutral-900 dark:text-neutral-50">{slot.subject}</span>
                          </p>
                          {isSubmitted && (
                            <p className="text-[10px] sm:text-xs text-neutral-400 dark:text-neutral-500">
                              Saved at {new Date(record.timestamp).toLocaleTimeString()}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleMarkAttendance(slotKey, slot, "PRESENT")}
                              disabled={submitting[slotKey]}
                              aria-label={`Mark present for ${slot.start}–${slot.end}`}
                              title={record?.status === "PRESENT" ? "Click to unmark" : "Mark as Present"}
                              className={cn(
                                "flex-1 rounded-lg py-2.5 text-xs sm:text-sm font-medium border transition-all",
                                record?.status === "PRESENT"
                                  ? "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600"
                                  : "bg-white dark:bg-neutral-900 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40",
                                submitting[slotKey] && "opacity-60 cursor-not-allowed"
                              )}
                            >
                              {submitting[slotKey] ? "..." : record?.status === "PRESENT" ? "✓ Present ×" : "Present"}
                            </button>
                            <button
                              onClick={() => handleMarkAttendance(slotKey, slot, "ABSENT")}
                              disabled={submitting[slotKey]}
                              aria-label={`Mark absent for ${slot.start}–${slot.end}`}
                              title={record?.status === "ABSENT" ? "Click to unmark" : "Mark as Absent"}
                              className={cn(
                                "flex-1 rounded-lg py-2.5 text-xs sm:text-sm font-medium border transition-all",
                                record?.status === "ABSENT"
                                  ? "bg-rose-500 border-rose-500 text-white hover:bg-rose-600 hover:border-rose-600"
                                  : "bg-white dark:bg-neutral-900 border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40",
                                submitting[slotKey] && "opacity-60 cursor-not-allowed"
                              )}
                            >
                              {submitting[slotKey] ? "..." : record?.status === "ABSENT" ? "✗ Absent ×" : "Absent"}
                            </button>
                          </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
                </div>
              </>
              )}
          </div>
        </motion.section>
        )}

        {/* ─── ANALYSIS SECTION ─── */}
        {currentSection === "analysis" && (
          <motion.section
            id="analysis"
            key="analysis"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            <h2 className="text-xl font-bold sm:text-2xl">Attendance Analysis</h2>

            {/* Filter tabs */}
            <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-950 w-fit">
              {analysisTabs.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setAnalysisFilter(key)}
                  className={cn(
                    "rounded-md px-3.5 py-1.5 text-xs font-medium transition-all select-none",
                    analysisFilter === key
                      ? "bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: analysisFilter === "all" ? "Overall" : analysisTabs.find((f) => f.key === analysisFilter)!.label,
                  value: analysisFilter === "all"
                    ? (totalClasses > 0 ? `${overallPercentage}%` : "N/A")
                    : (analysisFiltAtt.tot > 0 ? `${analysisFiltAtt.pct}%` : "N/A"),
                  sub: analysisFilter === "all"
                    ? `${totalAttended}/${totalClasses} classes`
                    : `${analysisFiltAtt.att}/${analysisFiltAtt.tot} classes`,
                  color: "text-indigo-500",
                },
                {
                  label: "Initial",
                  value: initialAttendance && initialAttendance.total > 0 ? `${initialPercentage}%` : "N/A",
                  sub: initialAttendance ? `${initialAttendance.attended}/${initialAttendance.total}` : "—",
                  color: "text-sky-500",
                },
                {
                  label: "Today",
                  value: (() => { const ts = rawDateRecords[format(new Date(), "yyyy-MM-dd")] || {}; let p = 0, t = 0; Object.values(ts).forEach(r => { const c = r.classCount || 1; t += c; if (r.status === "PRESENT") p += c; }); return t > 0 ? `${Math.round((p/t)*100)}%` : "N/A"; })(),
                  sub: (() => { const ts = rawDateRecords[format(new Date(), "yyyy-MM-dd")] || {}; let p = 0, t = 0; Object.values(ts).forEach(r => { const c = r.classCount || 1; t += c; if (r.status === "PRESENT") p += c; }); return t > 0 ? `${p}/${t} today` : "Not marked yet"; })(),
                  color: "text-violet-500",
                },
                {
                  label: "Subjects",
                  value: `${Object.values(rawDateRecords).flatMap(s => Object.values(s).map(r => r.subjectId)).filter((v, i, a) => a.indexOf(v) === i).length || analysisSubjectStats.length}`,
                  sub: "unique subjects",
                  color: "text-teal-500",
                },
              ].map((s) => (
                <Card key={s.label}>
                  <CardContent className="py-4 px-4">
                    <p className="text-[11px] text-neutral-400 mb-1">{s.label}</p>
                    <p className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.value}</p>
                    <p className="text-[11px] text-neutral-400 mt-0.5">{s.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Donut + Subject progress bars */}
            <div className="grid gap-4 md:grid-cols-5">
              <Card className="md:col-span-2">
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm">Overall Attendance</CardTitle>
                  <CardDescription className="text-xs">Initial + all app-tracked</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative h-[178px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Present", value: totalAttended },
                            { name: "Absent",  value: Math.max(0, totalClasses - totalAttended) },
                          ]}
                          cx="50%" cy="50%" innerRadius={52} outerRadius={74}
                          paddingAngle={totalClasses > 0 ? 3 : 0}
                          dataKey="value" startAngle={90} endAngle={-270} strokeWidth={0}
                        >
                          <Cell fill={donutClr} />
                          <Cell fill="#f1f5f9" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-3xl font-bold tabular-nums text-neutral-800 dark:text-neutral-100">
                        {totalClasses > 0 ? `${overallPercentage}%` : "—"}
                      </span>
                      <span className="text-[11px] text-neutral-400 mt-0.5">overall</span>
                    </div>
                  </div>
                  <div className="flex justify-center gap-5 mt-1">
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="h-2 w-2 rounded-full inline-block" style={{ background: donutClr }} />Present ({totalAttended})
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="h-2 w-2 rounded-full bg-slate-200 inline-block" />Absent ({Math.max(0, totalClasses - totalAttended)})
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="md:col-span-3">
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm">Subject-wise</CardTitle>
                  <CardDescription className="text-xs">
                    {analysisFilter === "all" ? "All app-tracked classes" : analysisTabs.find((f) => f.key === analysisFilter)!.label}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {analysisSubjectStats.length === 0 ? (
                    <div className="py-10 text-center text-xs text-neutral-400">No data for this period</div>
                  ) : (
                    <div className="space-y-2.5 max-h-[205px] overflow-y-auto pr-1">
                      {analysisSubjectStats.map((s) => (
                        <div key={s.subject}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-medium truncate mr-2">{s.subject}</span>
                            <div className="flex items-center gap-2 shrink-0 text-[11px]">
                              <span className="text-neutral-400 tabular-nums">{s.present}/{s.total}</span>
                              <span className={cn(
                                "font-semibold tabular-nums",
                                s.percentage >= 75 ? "text-indigo-600" : s.percentage >= 50 ? "text-amber-600" : "text-rose-600"
                              )}>{s.percentage}%</span>
                            </div>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-neutral-800 overflow-hidden">
                            <div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${s.percentage}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Subject bar chart — percentage-based */}
            {analysisSubjectStats.length > 0 && (
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-neutral-400" />
                    Attendance % by Subject
                  </CardTitle>
                  <CardDescription className="text-xs">Hover a point for present / absent / total details</CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  <ChartContainer config={subjectChartConfig} height={260}>
                    <LineChart
                      data={[...analysisSubjectStats].sort((a, b) => a.subject.localeCompare(b.subject))}
                      margin={{ top: 16, right: 24, left: -12, bottom: 48 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="subject"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        cursor={{ stroke: "#e2e8f0", strokeWidth: 1 }}
                        content={(props) => {
                          if (!props.active || !props.payload?.length) return null;
                          const d = props.payload[0]?.payload as { subject: string; present: number; absent: number; total: number; percentage: number };
                          return (
                            <div className="rounded-xl border border-neutral-200/80 bg-white px-3.5 py-2.5 shadow-lg text-xs min-w-[170px] dark:border-neutral-800 dark:bg-neutral-950">
                              <p className="mb-2 font-semibold text-[11px] uppercase tracking-wide text-neutral-500">{d.subject}</p>
                              <div className="space-y-1.5">
                                <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-indigo-600 inline-block" />Present</span><span className="font-semibold">{d.present}</span></div>
                                <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-200 inline-block" />Absent</span><span className="font-semibold">{d.absent}</span></div>
                                <div className="border-t border-neutral-100 dark:border-neutral-800 pt-1.5 flex justify-between gap-4"><span className="text-neutral-500">Total</span><span className="font-semibold">{d.total}</span></div>
                                <div className="flex justify-between gap-4"><span className="text-neutral-500">Attendance</span><span className={cn("font-bold", d.percentage >= 75 ? "text-indigo-600" : d.percentage >= 50 ? "text-amber-600" : "text-rose-600")}>{d.percentage}%</span></div>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="percentage"
                        stroke="#4f46e5"
                        strokeWidth={2.5}
                        dot={(props) => {
                          const { cx, cy, payload } = props;
                          const color = payload.percentage >= 75 ? "#4f46e5" : payload.percentage >= 50 ? "#d97706" : "#dc2626";
                          return <circle key={payload.subject} cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={2} />;
                        }}
                        activeDot={{ r: 7, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ChartContainer>
                  <div className="flex justify-center gap-5 mt-1">
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-600 inline-block" />≥75%
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block" />50–74%
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-600 inline-block" />&lt;50%
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Trend chart */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-neutral-400" />
                  {analysisFilter === "daily" ? "Today — Period by Period" : analysisFilter === "monthly" ? "This Month — By Period" : "12-Week Trend"}
                </CardTitle>
                <CardDescription className="text-xs">
                  {analysisFilter === "all" ? "Classes present and absent per week" : "Classes in the selected period"}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                {analysisFilter === "all" && analysisTrendData.filter((t) => t.total > 0).length === 0 ? (
                  <div className="h-[160px] flex items-center justify-center">
                    <div className="text-center">
                      <CalendarDays className="h-7 w-7 text-neutral-200 mx-auto mb-2" />
                      <p className="text-xs text-neutral-400">No data yet — start marking attendance!</p>
                    </div>
                  </div>
                ) : analysisFilter === "all" ? (
                  <ChartContainer config={trendChartConfig} height={210}>
                    <LineChart data={analysisTrendData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip cursor={{ stroke: "#e2e8f0", strokeWidth: 1 }} content={<ChartTooltipContent showTotal labelFormatter={(l) => `Week of ${l}`} />} />
                      <Line type="monotone" dataKey="present" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3, fill: "#4f46e5", strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                      <Line type="monotone" dataKey="absent"  stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                    </LineChart>
                  </ChartContainer>
                ) : (
                  <ChartContainer config={trendChartConfig} height={210}>
                    <BarChart data={analysisTrendData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip cursor={{ fill: "#f8fafc" }} content={<ChartTooltipContent showTotal />} />
                      <Bar dataKey="present" fill="#4f46e5" radius={[3, 3, 0, 0]} stackId="t" />
                      <Bar dataKey="absent"  fill="#e2e8f0" radius={[3, 3, 0, 0]} stackId="t" />
                    </BarChart>
                  </ChartContainer>
                )}
                {(analysisFilter !== "all") && analysisTrendData.filter((t) => t.total > 0).length === 0 && (
                  <p className="text-center text-xs text-neutral-400 mt-2">No classes marked for this period yet</p>
                )}
              </CardContent>
            </Card>
          </motion.section>
        )}

              </div>
            </main>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
