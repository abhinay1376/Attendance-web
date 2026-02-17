"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, doc, setDoc, getDoc } from "firebase/firestore";
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

      snapshot.forEach((doc) => {
        const data = doc.data() as PeriodAttendance;
        Object.values(data).forEach((record) => {
          const count = record.classCount || 1;
          total += count;
          if (record.status === "PRESENT") {
            attended += count;
          }
        });
      });

      setAppAttended(attended);
      setAppTotal(total);
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

  const handleMarkAttendance = async (slotKey: string, slot: TimetableSlot, status: "PRESENT" | "ABSENT") => {
    if (!user) return;

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

    setSubmitting({ ...submitting, [slotKey]: true });

    try {
      const attendanceDoc = doc(db, "attendance", user.uid, "dates", selectedDateStr);
      const record: AttendanceRecord = {
        subjectId: slot.subject,
        status,
        timestamp: Date.now(),
        classCount: slot.classCount || 1,
      };

      await setDoc(attendanceDoc, {
        [slotKey]: record,
      }, { merge: true });

      setAttendance({
        ...attendance,
        [slotKey]: record,
      });
    } catch (error) {
      console.error("Error marking attendance:", error);
      alert("Network error. Please try again.");
    } finally {
      setSubmitting({ ...submitting, [slotKey]: false });
    }
  };

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
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-neutral-600 dark:text-neutral-400 md:block">
                {userName || user.email}
              </span>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
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
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      onClick={() => setCurrentSection(item.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </a>
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
                          <a
                            key={item.id}
                            href={`#${item.id}`}
                            onClick={() => {
                              setCurrentSection(item.id);
                              setMobileMenuOpen(false);
                            }}
                            className={cn(
                              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                            )}
                          >
                            <Icon className="h-4 w-4" />
                            {item.label}
                          </a>
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
        <section id="overview">
        {/* Attendance Summary - Compact for mobile */}
        <Card elevation={2}>
          <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-2">
            <CardTitle className="text-base sm:text-lg">Attendance Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {/* Before App */}
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 sm:p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-[10px] sm:text-xs text-neutral-500 mb-0.5 sm:mb-1">Before</p>
                {initialAttendance ? (
                  <>
                    <p className="text-sm sm:text-lg font-bold">
                      {initialAttendance.attended}/{initialAttendance.total}
                    </p>
                    <p className="text-[10px] sm:text-xs text-neutral-500">
                      {initialPercentage.toFixed(0)}%
                    </p>
                  </>
                ) : (
                  <p className="text-xs sm:text-sm text-neutral-400">N/A</p>
                )}
              </div>

              {/* Using App */}
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 sm:p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-[10px] sm:text-xs text-neutral-500 mb-0.5 sm:mb-1">App</p>
                <p className="text-sm sm:text-lg font-bold">{appAttended}/{appTotal}</p>
                <p className="text-[10px] sm:text-xs text-neutral-500">{appPercentage.toFixed(0)}%</p>
              </div>

              {/* Overall */}
              <div className={cn(
                "rounded-lg border-2 p-2 sm:p-3",
                overallPercentage >= 75 
                  ? "border-green-500 bg-green-50 dark:bg-green-950/30" 
                  : "border-red-500 bg-red-50 dark:bg-red-950/30"
              )}>
                <p className="text-[10px] sm:text-xs text-neutral-500 mb-0.5 sm:mb-1">Total</p>
                <p className="text-sm sm:text-lg font-bold">{totalAttended}/{totalClasses}</p>
                <p className={cn(
                  "text-[10px] sm:text-xs font-semibold",
                  overallPercentage >= 75 ? "text-green-600" : "text-red-600"
                )}>
                  {overallPercentage.toFixed(0)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        </section>

        {/* ─── MARK ATTENDANCE SECTION ─── */}
        <section id="attendance">
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
                  <div key={slotKey} className={fadeClass}>
                    <Card elevation={3}>
                      <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-3">
                        <CardTitle className="text-sm sm:text-lg flex flex-wrap items-center gap-1">
                          <span>{slot.start} – {slot.end}</span>
                          <span className="text-xs sm:text-sm font-normal text-blue-600 dark:text-blue-400">
                            ({slot.classCount} class{slot.classCount > 1 ? 'es' : ''})
                          </span>
                        </CardTitle>
                        <AnimatePresence mode="wait">
                          {isSubmitted && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <CardDescription>
                                Marked as{" "}
                                <span
                                  className={
                                    record.status === "PRESENT"
                                      ? "font-semibold text-green-600 dark:text-green-400"
                                      : "font-semibold text-red-600 dark:text-red-400"
                                  }
                                >
                                  {record.status}
                                </span>
                              </CardDescription>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </CardHeader>
                      <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0 space-y-3 sm:space-y-4">
                        <AnimatePresence mode="wait">
                          {isSubmitted ? (
                            <motion.div
                              key="submitted"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="space-y-2 sm:space-y-3"
                            >
                              <p className="text-xs sm:text-sm text-neutral-600 dark:text-neutral-400">
                                Subject:{" "}
                                <span className="font-medium text-neutral-900 dark:text-neutral-50">
                                  {slot.subject}
                                </span>
                              </p>
                              <p className="text-[10px] sm:text-xs text-neutral-500 dark:text-neutral-400">
                                Submitted at {new Date(record.timestamp).toLocaleTimeString()}
                              </p>
                              <div className="flex gap-2 pt-1">
                                <Button
                                  size="sm"
                                  variant={record.status === "PRESENT" ? "outline" : "default"}
                                  className={cn(
                                    "h-8 text-xs sm:h-9 sm:text-sm",
                                    record.status !== "PRESENT" ? "bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-800" : ""
                                  )}
                                  onClick={() => handleMarkAttendance(slotKey, slot, "PRESENT")}
                                  disabled={submitting[slotKey] || record.status === "PRESENT"}
                                >
                                  {submitting[slotKey] ? <LoadingSpinner size="sm" /> : "Present"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={record.status === "ABSENT" ? "outline" : "default"}
                                  className={cn(
                                    "h-8 text-xs sm:h-9 sm:text-sm",
                                    record.status !== "ABSENT" ? "bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-800" : ""
                                  )}
                                  onClick={() => handleMarkAttendance(slotKey, slot, "ABSENT")}
                                  disabled={submitting[slotKey] || record.status === "ABSENT"}
                                >
                                  {submitting[slotKey] ? <LoadingSpinner size="sm" /> : "Absent"}
                                </Button>
                              </div>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="form"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="space-y-3 sm:space-y-4"
                            >
                              <div className="space-y-1 sm:space-y-2">
                                <p className="text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200">
                                  Subject
                                </p>
                                <p className="text-xs sm:text-sm text-neutral-900 dark:text-neutral-50 font-medium">
                                  {slot.subject}
                                </p>
                              </div>

                              <div className="flex gap-2">
                                <Button
                                  className="flex-1 bg-green-600 hover:bg-green-700 text-white min-h-[40px] sm:min-h-[44px] text-xs sm:text-sm dark:bg-green-700 dark:hover:bg-green-800"
                                  onClick={() => handleMarkAttendance(slotKey, slot, "PRESENT")}
                                  disabled={submitting[slotKey]}
                                  aria-label={`Mark present for ${slot.start}–${slot.end}`}
                                >
                                  {submitting[slotKey] ? (
                                    <LoadingSpinner size="sm" />
                                  ) : (
                                    "Present"
                                  )}
                                </Button>
                                <Button
                                  className="flex-1 bg-red-600 hover:bg-red-700 text-white min-h-[40px] sm:min-h-[44px] text-xs sm:text-sm dark:bg-red-700 dark:hover:bg-red-800"
                                  onClick={() => handleMarkAttendance(slotKey, slot, "ABSENT")}
                                  disabled={submitting[slotKey]}
                                  aria-label={`Mark absent for ${slot.start}–${slot.end}`}
                                >
                                  {submitting[slotKey] ? (
                                    <LoadingSpinner size="sm" />
                                  ) : (
                                    "Absent"
                                  )}
                                </Button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
                </div>
              )}
          </div>
        </section>

              </div>
            </main>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
