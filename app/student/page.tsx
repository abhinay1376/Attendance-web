"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ADMIN_EMAIL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageTransition } from "@/components/page-transition";
import { CalendarIcon, Info } from "lucide-react";
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
  const { user, loading } = useAuth();

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

  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");
  const isToday = selectedDateStr === today;

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push("/login");
      } else if (user.email === ADMIN_EMAIL) {
        router.push("/admin");
      }
    }
  }, [user, loading, router]);

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
        console.warn("User has no section assigned");
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
    if (selectedDateStr > today) {
      alert("Cannot mark attendance for future dates.");
      return;
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

  if (loading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user || user.email === ADMIN_EMAIL) {
    return null;
  }

  if (!isApproved) {
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
    // Future dates always disabled
    if (dateStr > today) return true;
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

  return (
    <PageTransition>
      <div className="min-h-screen page-background p-4">
        <div className="mx-auto max-w-6xl space-y-6 py-8 perspective-container">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Attendance</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              Logged in as {user.email}
            </p>
          </div>
          <Button onClick={handleSignOut} variant="outline">
            Sign Out
          </Button>
        </div>

        {/* Attendance Summary */}
        <Card elevation={3}>
          <CardHeader>
            <CardTitle>Attendance Summary</CardTitle>
            <CardDescription>Your complete attendance record</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Before App */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Before App
                </h3>
                {initialAttendance ? (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <p className="text-2xl font-bold text-foreground">
                      {initialAttendance.attended} / {initialAttendance.total}
                    </p>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      {initialPercentage.toFixed(2)}% attendance
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                      Up to {new Date(initialAttendance.uptoDate).toLocaleDateString()}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Not set yet
                  </p>
                )}
              </div>

              {/* Using App */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Using App
                </h3>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <p className="text-2xl font-bold text-foreground">
                    {appAttended} / {appTotal}
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {appPercentage.toFixed(2)}% attendance
                  </p>
                </div>
              </div>

              {/* Overall */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Overall
                </h3>
                <div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
                  <p className="text-2xl font-bold text-foreground">
                    {totalAttended} / {totalClasses}
                  </p>
                  <p className={`text-sm font-semibold ${overallPercentage >= 75 ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}`}>
                    {overallPercentage.toFixed(2)}% attendance
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Date Selection */}
        <Card elevation={3}>
          <CardHeader>
            <CardTitle>Select Date</CardTitle>
            <CardDescription>
              Choose a date to mark your attendance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Helper text about date restrictions */}
            {initialAttendance && (
              <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <AlertDescription className="ml-7 text-sm text-blue-800 dark:text-blue-200">
                  Attendance before{" "}
                  <strong>{format(new Date(initialAttendance.uptoDate), "MMMM d, yyyy")}</strong>{" "}
                  is already counted.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <label 
                  htmlFor="date-picker" 
                  className="text-sm font-medium text-neutral-700 dark:text-neutral-200"
                >
                  Attendance Date
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="date-picker"
                      variant="outline"
                      className="justify-start text-left font-normal w-fit h-9 px-3 text-sm"
                      aria-label="Select attendance date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(selectedDate, "EEE, MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
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
                      className="rounded-md border-0 [--cell-size:36px]"
                    />
                  </PopoverContent>
                </Popover>

                {/* Date status badge */}
                <div className="flex items-center gap-2">
                  {isToday ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      Today&apos;s attendance
                    </span>
                  ) : isPastDate ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                      Attendance for {format(selectedDate, "MMM d, yyyy")}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Error message for invalid dates */}
              {!isSelectedDateValid && (
                <Alert variant="destructive">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="ml-7">
                    {isFutureDate
                      ? "You cannot mark attendance for future dates."
                      : isHoliday
                      ? `This day is marked as a holiday. Reason: ${holidayReasons.get(selectedDateStr) || "Holiday"}`
                      : isSunday
                      ? "Sundays are not valid for attendance."
                      : cutoffDate && selectedDateStr <= format(cutoffDate, "yyyy-MM-dd")
                      ? `This date is before the cutoff date (${format(cutoffDate, "MMMM d, yyyy")}). Attendance is already counted.`
                      : "The selected date is not valid for attendance."}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Period Cards */}
        <div>
          <h2 className="text-xl font-semibold mb-4">
            {isToday
              ? `Today's Classes (${selectedDayName})`
              : `Classes for ${format(selectedDate, "MMMM d, yyyy")} (${selectedDayName})`}
          </h2>



          {!isSelectedDateValid ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Info className="mx-auto h-12 w-12 text-neutral-400 dark:text-neutral-600 mb-4" />
                <p className="text-base font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Cannot Mark Attendance
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Please select a valid date from the calendar above.
                </p>
              </CardContent>
            </Card>
          ) : slotsForDate.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Info className="mx-auto h-12 w-12 text-neutral-400 dark:text-neutral-600 mb-4" />
                <p className="text-base font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  No Classes Scheduled
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Your timetable shows no classes for {selectedDayName}.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                      <CardHeader>
                        <CardTitle className="text-lg">
                          {slot.start} – {slot.end}
                          <span className="ml-2 text-sm font-normal text-blue-600 dark:text-blue-400">
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
                      <CardContent className="space-y-4">
                        <AnimatePresence mode="wait">
                          {isSubmitted ? (
                            <motion.div
                              key="submitted"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="space-y-3"
                            >
                              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                Subject:{" "}
                                <span className="font-medium text-neutral-900 dark:text-neutral-50">
                                  {slot.subject}
                                </span>
                              </p>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                Submitted at {new Date(record.timestamp).toLocaleTimeString()}
                              </p>
                              <div className="flex gap-2 pt-1">
                                <Button
                                  size="sm"
                                  variant={record.status === "PRESENT" ? "outline" : "default"}
                                  className={record.status !== "PRESENT" ? "bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-800" : ""}
                                  onClick={() => handleMarkAttendance(slotKey, slot, "PRESENT")}
                                  disabled={submitting[slotKey] || record.status === "PRESENT"}
                                >
                                  {submitting[slotKey] ? <LoadingSpinner size="sm" /> : "Present"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={record.status === "ABSENT" ? "outline" : "default"}
                                  className={record.status !== "ABSENT" ? "bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-800" : ""}
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
                              className="space-y-4"
                            >
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                                  Subject
                                </p>
                                <p className="text-sm text-neutral-900 dark:text-neutral-50 font-medium">
                                  {slot.subject}
                                </p>
                              </div>

                              <div className="flex gap-2">
                                <Button
                                  className="flex-1 bg-green-600 hover:bg-green-700 text-white min-h-[44px] dark:bg-green-700 dark:hover:bg-green-800"
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
                                  className="flex-1 bg-red-600 hover:bg-red-700 text-white min-h-[44px] dark:bg-red-700 dark:hover:bg-red-800"
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
        </div>
      </div>
    </PageTransition>
  );
}
