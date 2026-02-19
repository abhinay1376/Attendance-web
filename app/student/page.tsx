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
import { PageTransition } from "@/components/page-transition";
import { Badge } from "@/components/ui/badge";
import { Collapsible } from "@/components/ui/collapsible";
import { CalendarIcon, Info, LogOut, AlertTriangle, CheckCircle, XCircle, LayoutDashboard, BookOpen, History, Menu, X } from "lucide-react";
import { format } from "date-fns";
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
      let attended = 0;
      let total = 0;
      const dates = new Set<string>();

      snapshot.forEach((doc) => {
        const data = doc.data() as PeriodAttendance;
        const records = Object.values(data);

        if (records.length > 0) {
          dates.add(doc.id);
        }

        records.forEach((record) => {
          const count = record.classCount || 1;
          total += count;
          if (record.status === "PRESENT") {
            attended += count;
          }
        });
      });

      setAppAttended(attended);
      setAppTotal(total);
      setAllAttendanceDates(dates);
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
      alert("Network error. Please try again.");
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
      alert("Cannot mark attendance for future dates.");
      return;
    }
    // Limit to 7 days ahead
    if (selectedDateStr > today && allowFutureAttendance) {
      const maxFutureDate = new Date();
      maxFutureDate.setDate(maxFutureDate.getDate() + 7);
      if (new Date(selectedDateStr) > maxFutureDate) {
        alert("Cannot mark attendance more than 7 days in advance.");
        return;
      }
    }
    if (holidays.has(selectedDateStr)) {
      alert("Cannot mark attendance on a holiday.");
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
      alert("Network error. Please try again.");
    } finally {
      setSubmitting((prev) => ({ ...prev, [slotKey]: false }));
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

  if (loading || profileLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
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

  const menuItems = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "attendance", label: "Mark Attendance", icon: BookOpen },
    { id: "history", label: "History", icon: History },
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
                    </nav>
                  </motion.aside>
                </>
              )}
            </AnimatePresence>

            {/* ─── MAIN CONTENT ─── */}
            <main className="flex-1 p-4 lg:p-6">
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
                  const color = pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
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
                  overallPercentage >= 75 ? "text-green-600" : overallPercentage >= 50 ? "text-amber-600" : "text-red-600"
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

          {/* ─── MARK ATTENDANCE (inline on overview) ─── */}
          <div className="mt-6">
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
              )}
          </div>
        </motion.section>
        )}

        {/* ─── HISTORY SECTION ─── */}
        {currentSection === "history" && (
        <motion.section
          id="history"
          key="history"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Card elevation={2}>
            <CardHeader>
              <CardTitle>Attendance History</CardTitle>
              <CardDescription>Your full attendance record</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-500">Coming soon — detailed history view.</p>
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
