"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, doc, setDoc, getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ADMIN_EMAIL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AnimatedCard } from "@/components/ui/animated-card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageTransition } from "@/components/page-transition";
import { CalendarIcon, Info } from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

interface Subject {
  id: string;
  name: string;
}

interface Period {
  id: string;
  label: string;
}

interface AttendanceRecord {
  subjectId: string;
  status: "PRESENT" | "ABSENT";
  timestamp: number;
  classCount: number; // Number of classes for this period
}

interface PeriodAttendance {
  [periodId: string]: AttendanceRecord;
}

interface InitialAttendance {
  attended: number;
  total: number;
  uptoDate: string;
}

interface Holiday {
  date: string;
  reason: string;
}

interface TimetableEntry {
  id: string;
  sectionId: string;
  day: string;
  subjectId: string;
  startTime: string;
  endTime: string;
  order: number;
  classCount: number; // Number of classes based on duration (1 class = 50 mins)
}

export default function StudentPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [attendance, setAttendance] = useState<PeriodAttendance>({});
  const [submitting, setSubmitting] = useState<{ [periodId: string]: boolean }>({});
  const [initialAttendance, setInitialAttendance] = useState<InitialAttendance | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [appAttended, setAppAttended] = useState(0);
  const [appTotal, setAppTotal] = useState(0);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [holidayReasons, setHolidayReasons] = useState<Map<string, string>>(new Map());
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [userSection, setUserSection] = useState<string>("");

  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");
  const todayDate = new Date();
  const dayOfWeek = format(todayDate, "EEEE"); // Monday, Tuesday, etc.

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push("/login");
      } else if (user.email === ADMIN_EMAIL) {
        router.push("/admin");
      }
    }
  }, [user, loading, router]);

  // Check approval and section
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const checkUserStatus = async () => {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        
        // Check section - should always exist for new registrations
        if (!data.sectionId) {
          console.error("User has no section assigned");
          router.push("/pending-approval");
          return;
        }
        
        setUserSection(data.sectionId);
        
        const approved = data.approved === true;
        setIsApproved(approved);
        if (!approved) {
          router.push("/pending-approval");
        }
      } else {
        console.error("User document not found");
        router.push("/pending-approval");
      }
    };

    checkUserStatus();
  }, [user, router]);

  // Load initial attendance
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const loadInitialAttendance = async () => {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.initialAttendance) {
          setInitialAttendance(data.initialAttendance);
        }
      }
    };

    loadInitialAttendance();

    const unsubscribe = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.initialAttendance) {
          setInitialAttendance(data.initialAttendance);
        }
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Calculate app-based attendance
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const calculateAppAttendance = async () => {
      const attendanceRef = collection(db, "attendance", user.uid, "dates");
      const snapshot = await getDocs(attendanceRef);
      
      let attended = 0;
      let total = 0;

      snapshot.forEach((doc) => {
        const data = doc.data() as PeriodAttendance;
        Object.values(data).forEach((record) => {
          total++;
          if (record.status === "PRESENT") {
            attended++;
          }
        });
      });

      setAppAttended(attended);
      setAppTotal(total);
    };

    calculateAppAttendance();

    // Listen for changes
    const unsubscribe = onSnapshot(collection(db, "attendance", user.uid, "dates"), () => {
      calculateAppAttendance();
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to subjects collection
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(collection(db, "subjects"), (snapshot) => {
      const subjectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
      }));
      setSubjects(subjectsData);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to timetable for user's section
  useEffect(() => {
    if (!user || user.email === ADMIN_EMAIL || !userSection) return;

    const q = query(
      collection(db, "timetable"),
      where("sectionId", "==", userSection)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const timetableData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as TimetableEntry));
      setTimetable(timetableData);
    });

    return () => unsubscribe();
  }, [user, userSection]);

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

  const handleMarkAttendance = async (entryId: string, status: "PRESENT" | "ABSENT") => {
    if (!user) return;

    // Get the timetable entry to find the subject and class count
    const entry = timetable.find(e => e.id === entryId);
    if (!entry) return;

    setSubmitting({ ...submitting, [entryId]: true });

    try {
      const attendanceDoc = doc(db, "attendance", user.uid, "dates", selectedDateStr);
      const record: AttendanceRecord = {
        subjectId: entry.subjectId,
        status,
        timestamp: Date.now(),
        classCount: entry.classCount || 1, // Default to 1 for legacy entries
      };

      await setDoc(attendanceDoc, {
        [entryId]: record,
      }, { merge: true });

      setAttendance({
        ...attendance,
        [entryId]: record,
      });
    } catch (error) {
      console.error("Error marking attendance:", error);
    } finally {
      setSubmitting({ ...submitting, [entryId]: false });
    }
  };

  if (loading) {
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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Date validation
  const cutoffDate = initialAttendance ? new Date(initialAttendance.uptoDate) : null;
  const isDateDisabled = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    // Disable future dates
    if (dateStr > today) return true;
    // Disable dates on or before cutoff date
    if (cutoffDate && dateStr <= format(cutoffDate, "yyyy-MM-dd")) return true;
    // Disable holidays
    if (holidays.has(dateStr)) return true;
    return false;
  };

  const isSelectedDateValid = !isDateDisabled(selectedDate);
  const isHoliday = holidays.has(selectedDateStr);

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
                      className="w-full justify-start text-left font-normal sm:w-[320px] h-11 px-4"
                      aria-label="Select attendance date"
                    >
                      <CalendarIcon className="mr-2 h-5 w-5" />
                      <span className="text-base">{format(selectedDate, "EEEE, MMMM d, yyyy")}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
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
                      className="rounded-md"
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {selectedDateStr === today 
                    ? "Today's attendance" 
                    : selectedDateStr > today 
                    ? "Future date selected"
                    : "Past date selected"}
                </p>
              </div>

              {/* Error message for invalid dates */}
              {!isSelectedDateValid && (
                <Alert variant="destructive">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="ml-7">
                    {selectedDateStr > today
                      ? "You cannot mark attendance for future dates. Please select today or a previous date."
                      : isHoliday
                      ? `This day is marked as a holiday by admin. Reason: ${holidayReasons.get(selectedDateStr) || "Holiday"}`
                      : cutoffDate && selectedDateStr <= format(cutoffDate, "yyyy-MM-dd")
                      ? `This date is before the cutoff date (${format(cutoffDate, "MMMM d, yyyy")}). Attendance for this period has already been counted and cannot be modified.`
                      : "The selected date is not valid for attendance entry."}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Period Cards - Show only if today and valid */}
        <div>
          <h2 className="text-xl font-semibold mb-4">
            {selectedDateStr === today 
              ? `Today's Classes (${dayOfWeek})`
              : `Classes for ${format(selectedDate, "MMMM d, yyyy")}`}
          </h2>
          
          {!isSelectedDateValid ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Info className="mx-auto h-12 w-12 text-neutral-400 dark:text-neutral-600 mb-4" />
                <p className="text-base font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Invalid Date Selected
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Please select a valid date from the calendar above to mark your attendance.
                </p>
              </CardContent>
            </Card>
          ) : selectedDateStr !== today ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Info className="mx-auto h-12 w-12 text-neutral-400 dark:text-neutral-600 mb-4" />
                <p className="text-base font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Only Today's Attendance
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  You can only mark attendance for today. Please select today's date.
                </p>
              </CardContent>
            </Card>
          ) : (() => {
              const todayTimetable = timetable
                .filter(t => t.day === dayOfWeek)
                .sort((a, b) => a.order - b.order);

              if (todayTimetable.length === 0) {
                return (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Info className="mx-auto h-12 w-12 text-neutral-400 dark:text-neutral-600 mb-4" />
                      <p className="text-base font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                        No Classes Today
                      </p>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        Your timetable shows no classes scheduled for {dayOfWeek}.
                      </p>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {todayTimetable.map((entry, index) => {
                    const isSubmitted = !!attendance[entry.id];
                    const record = attendance[entry.id];
                    const subject = subjects.find(s => s.id === entry.subjectId);
                    const fadeClass = index === 0 ? 'animate-fade-in'
                      : index === 1 ? 'animate-fade-in-delay-1'
                      : index === 2 ? 'animate-fade-in-delay-2'
                      : index === 3 ? 'animate-fade-in-delay-3'
                      : index === 4 ? 'animate-fade-in-delay-4'
                      : 'animate-fade-in-delay-5';

                    return (
                      <div
                        key={entry.id}
                        className={fadeClass}
                      >
                        <Card 
                          elevation={3}
                        >
                          <CardHeader>
                            <CardTitle className="text-lg">
                              {entry.startTime} – {entry.endTime}
                              <span className="ml-2 text-sm font-normal text-blue-600 dark:text-blue-400">
                                ({entry.classCount || 1} class{(entry.classCount || 1) > 1 ? 'es' : ''})
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
                                  className="space-y-2"
                                >
                                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                    Subject:{" "}
                                    <span className="font-medium text-neutral-900 dark:text-neutral-50">
                                      {subject?.name || "Unknown"}
                                    </span>
                                  </p>
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    Submitted at {new Date(record.timestamp).toLocaleTimeString()}
                                  </p>
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
                                      {subject?.name || "Unknown"}
                                    </p>
                                  </div>

                                  <div className="flex gap-2">
                                    <Button
                                      className="flex-1 bg-green-600 hover:bg-green-700 text-white min-h-[44px] dark:bg-green-700 dark:hover:bg-green-800"
                                      onClick={() => handleMarkAttendance(entry.id, "PRESENT")}
                                      disabled={submitting[entry.id]}
                                      aria-label={`Mark present for ${entry.startTime}–${entry.endTime}`}
                                    >
                                      {submitting[entry.id] ? (
                                        <LoadingSpinner size="sm" />
                                      ) : (
                                        "Present"
                                      )}
                                    </Button>
                                    <Button
                                      className="flex-1 bg-red-600 hover:bg-red-700 text-white min-h-[44px] dark:bg-red-700 dark:hover:bg-red-800"
                                      onClick={() => handleMarkAttendance(entry.id, "ABSENT")}
                                      disabled={submitting[entry.id]}
                                      aria-label={`Mark absent for ${entry.startTime}–${entry.endTime}`}
                                    >
                                      {submitting[entry.id] ? (
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
              );
            })()}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
