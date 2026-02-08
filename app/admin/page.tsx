"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, addDoc, getDocs, deleteDoc, doc, onSnapshot, setDoc, writeBatch, query, where } from "firebase/firestore";
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
import { PageTransition } from "@/components/page-transition";
import { CalendarIcon, AlertTriangle, Trash2, Clock } from "lucide-react";
import { format, parse } from "date-fns";

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

interface TimetableEntry {
  id: string;
  sectionId: string;
  day: string;
  subjectId: string;
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
  order: number;
  classCount: number; // Number of classes based on duration (1 class = 50 mins)
}

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

export default function AdminPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  // Real-time app attendance per student: uid -> { appAttended, appTotal }
  const [appAttendanceMap, setAppAttendanceMap] = useState<Record<string, AppAttendanceData>>({});
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  
  const [subjectName, setSubjectName] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [isAddingSubject, setIsAddingSubject] = useState(false);
  const [isAddingPeriod, setIsAddingPeriod] = useState(false);

  // Section management
  const [sectionName, setSectionName] = useState("");
  const [isAddingSection, setIsAddingSection] = useState(false);

  // Timetable management
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedDay, setSelectedDay] = useState("Monday");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isAddingTimetable, setIsAddingTimetable] = useState(false);

  // Helper function to calculate class count from duration
  const ONE_CLASS_DURATION = 50; // minutes
  
  const calculateClassCount = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const duration = endMinutes - startMinutes;
    if (duration <= 0) return 0;
    return Math.ceil(duration / ONE_CLASS_DURATION);
  };

  // Computed class count for preview
  const previewClassCount = calculateClassCount(startTime, endTime);

  // Initial attendance form state
  const [selectedStudentUid, setSelectedStudentUid] = useState("");
  const [attended, setAttended] = useState("");
  const [total, setTotal] = useState("");
  const [uptoDate, setUptoDate] = useState("");
  const [uptoDateCalendar, setUptoDateCalendar] = useState<Date | undefined>(undefined);
  const [isSavingInitial, setIsSavingInitial] = useState(false);

  // Holiday state
  const [holidayDate, setHolidayDate] = useState<Date | undefined>(new Date());
  const [holidayReason, setHolidayReason] = useState("");
  const [isAddingHoliday, setIsAddingHoliday] = useState(false);

  // Semester reset state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push("/login");
      } else if (user.email !== ADMIN_EMAIL) {
        router.push("/student");
      }
    }
  }, [user, loading, router]);

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
            initialAttendance: data.initialAttendance,
          });
        }
      });
      setStudents(studentsData);
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

  // Listen to timetable collection
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;

    const unsubscribe = onSnapshot(collection(db, "timetable"), (snapshot) => {
      const timetableData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as TimetableEntry));
      setTimetable(timetableData);
    });

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
    let loadedCount = 0;

    approvedStudents.forEach((student) => {
      const datesRef = collection(db, "attendance", student.uid, "dates");
      const unsub = onSnapshot(datesRef, (snapshot) => {
        let attended = 0;
        let total = 0;
        snapshot.forEach((dateDoc) => {
          const data = dateDoc.data();
          Object.values(data).forEach((record: any) => {
            if (record && typeof record.status === "string") {
              total++;
              if (record.status === "PRESENT") {
                attended++;
              }
            }
          });
        });
        localMap[student.uid] = { appAttended: attended, appTotal: total };
        loadedCount++;
        // Update state with a fresh copy each time
        setAppAttendanceMap({ ...localMap });
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
    if (!holidayDate || !holidayReason.trim()) return;

    const dateStr = format(holidayDate, "yyyy-MM-dd");
    setIsAddingHoliday(true);

    try {
      // Log the action
      await addDoc(collection(db, "auditLog"), {
        action: "HOLIDAY_CREATED",
        date: dateStr,
        reason: holidayReason.trim(),
        performedBy: user?.email,
        timestamp: Date.now(),
      });

      // Create holiday
      await setDoc(doc(db, "holidays", dateStr), {
        reason: holidayReason.trim(),
        createdAt: Date.now(),
        markedBy: "admin",
      });

      setHolidayReason("");
      alert("Holiday marked successfully");
    } catch (error) {
      console.error("Error marking holiday:", error);
      alert("Error marking holiday");
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
    if (!confirm("Delete this section? This will remove associated timetable entries.")) return;

    try {
      // Delete section
      await deleteDoc(doc(db, "sections", sectionId));
      
      // Delete associated timetable entries
      const timetableQuery = query(collection(db, "timetable"), where("sectionId", "==", sectionId));
      const timetableSnapshot = await getDocs(timetableQuery);
      const batch = writeBatch(db);
      timetableSnapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      alert("Section deleted");
    } catch (error) {
      console.error("Error deleting section:", error);
      alert("Error deleting section");
    }
  };

  const handleAddTimetableEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSection || !selectedDay || !selectedSubject || !startTime || !endTime) return;

    const classCount = calculateClassCount(startTime, endTime);
    if (classCount <= 0) {
      alert("Invalid time range. End time must be after start time.");
      return;
    }

    setIsAddingTimetable(true);
    try {
      // Calculate order based on start time
      const existingEntries = timetable.filter(
        t => t.sectionId === selectedSection && t.day === selectedDay
      );
      const order = existingEntries.length;

      await addDoc(collection(db, "timetable"), {
        sectionId: selectedSection,
        day: selectedDay,
        subjectId: selectedSubject,
        startTime,
        endTime,
        order,
        classCount,
      });

      setSelectedSubject("");
      setStartTime("");
      setEndTime("");
      alert(`Timetable entry added (${classCount} class${classCount > 1 ? 'es' : ''})`);
    } catch (error) {
      console.error("Error adding timetable entry:", error);
      alert("Error adding timetable entry");
    } finally {
      setIsAddingTimetable(false);
    }
  };

  const handleDeleteTimetableEntry = async (entryId: string) => {
    if (!confirm("Delete this timetable entry?")) return;

    try {
      await deleteDoc(doc(db, "timetable", entryId));
    } catch (error) {
      console.error("Error deleting timetable entry:", error);
      alert("Error deleting entry");
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user || user.email !== ADMIN_EMAIL) {
    return null;
  }

  const selectedStudent = students.find(s => s.uid === selectedStudentUid);

  return (
    <PageTransition>
      <div className="min-h-screen page-background p-4">
        <div className="mx-auto max-w-6xl space-y-6 py-8 perspective-container">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              Logged in as {user.email}
            </p>
          </div>
          <Button onClick={handleSignOut} variant="outline">
            Sign Out
          </Button>
        </div>

        {/* Initial Attendance Section */}
        <Card elevation={3}>
          <CardHeader>
            <CardTitle>Set Initial Attendance</CardTitle>
            <CardDescription>
              Enter pre-app attendance for students. Students can only mark attendance AFTER the cutoff date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveInitialAttendance} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Select Student
                </label>
                <select
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                  value={selectedStudentUid}
                  onChange={(e) => setSelectedStudentUid(e.target.value)}
                  disabled={isSavingInitial}
                >
                  <option value="">Select a student</option>
                  {students.map((student) => (
                    <option key={student.uid} value={student.uid}>
                      {student.email}
                      {student.initialAttendance && ` (Current: ${student.initialAttendance.attended}/${student.initialAttendance.total})`}
                    </option>
                  ))}
                </select>
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

        {/* Student Approval Section */}
        <Card elevation={3}>
          <CardHeader>
            <CardTitle>Student Approvals</CardTitle>
            <CardDescription>
              Approve or reject student registrations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {students.filter(s => s.approved !== true).length === 0 ? (
              <p className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-8">
                No pending approvals
              </p>
            ) : (
              <div className="space-y-3">
                {students
                  .filter(s => s.approved !== true)
                  .map((student) => {
                    const studentSection = student.sectionId ? sections.find(s => s.id === student.sectionId) : null;
                    return (
                    <div
                      key={student.uid}
                      className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                            {student.name || "No Name"}
                          </p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 font-mono">
                            {student.regNo || "No Reg No"}
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-yellow-100 px-3 py-1 dark:bg-yellow-900/30">
                          <span className="h-2 w-2 rounded-full bg-yellow-500"></span>
                          <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-500">
                            Pending
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">Branch</p>
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                            {student.branch || "N/A"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">Section</p>
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                            {studentSection?.name || "N/A"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">Phone</p>
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                            {student.phone || "N/A"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">Email</p>
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50 truncate">
                            {student.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApproveStudent(student.uid)}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-800"
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRejectStudent(student.uid)}
                          className="flex-1"
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                    );
                  })}
              </div>
            )}

            {students.filter(s => s.approved === true).length > 0 && (
              <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800">
                <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
                  Approved Students
                </h3>
                <div className="space-y-2">
                  {students
                    .filter(s => s.approved === true)
                    .map((student) => {
                      const studentSection = student.sectionId ? sections.find(sec => sec.id === student.sectionId) : null;
                      return (
                      <div
                        key={student.uid}
                        className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-2 rounded-full bg-green-500"></div>
                          <div>
                            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                              {student.name || student.email}
                            </p>
                            {student.regNo && (
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
                                {student.regNo}{studentSection ? ` • ${studentSection.name}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-green-600 dark:text-green-500">
                          Approved
                        </span>
                      </div>
                      );
                    })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── STUDENT ATTENDANCE OVERVIEW ─── */}
        <Card elevation={3}>
          <CardHeader>
            <CardTitle>Student Attendance Overview</CardTitle>
            <CardDescription>
              Real-time attendance for all approved students (Initial + App = Total)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attendanceLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner size="md" />
              </div>
            ) : students.filter(s => s.approved === true).length === 0 ? (
              <p className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-8">
                No approved students yet
              </p>
            ) : (
              <div className="space-y-3">
                {students
                  .filter(s => s.approved === true)
                  .map((student, idx) => {
                    const app = appAttendanceMap[student.uid] || { appAttended: 0, appTotal: 0 };
                    const att = computeAttendance(student.initialAttendance, app);
                    const studentSection = student.sectionId ? sections.find(sec => sec.id === student.sectionId) : null;
                    const barColor = att.totalClasses === 0 ? 'bg-neutral-300 dark:bg-neutral-600'
                      : att.percentage >= 75 ? 'bg-green-500' : att.percentage >= 50 ? 'bg-yellow-500' : 'bg-red-500';

                    return (
                      <div
                        key={student.uid}
                        className={`rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 animate-fade-in${idx < 5 ? `-delay-${idx + 1}` : ''}`}
                      >
                        {/* Student header */}
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                              {student.name || student.email}
                            </p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
                              {student.regNo || student.email}
                              {studentSection ? ` • ${studentSection.name}` : ''}
                            </p>
                          </div>
                          <div className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            att.totalClasses === 0
                              ? 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                              : att.percentage >= 75
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                              : att.percentage >= 50
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                          }`}>
                            {att.totalClasses > 0 ? `${att.percentage.toFixed(2)}%` : 'No data'}
                          </div>
                        </div>

                        {/* Progress bar */}
                        {att.totalClasses > 0 && (
                          <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full mb-3 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                              style={{ width: `${Math.min(att.percentage, 100)}%` }}
                            />
                          </div>
                        )}

                        {/* Breakdown row */}
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div className="rounded-md bg-neutral-50 p-2 dark:bg-neutral-800">
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">Initial</p>
                            <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50">
                              {att.initialAttended}/{att.initialTotal}
                            </p>
                          </div>
                          <div className="rounded-md bg-neutral-50 p-2 dark:bg-neutral-800">
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">App</p>
                            <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50">
                              {att.appAttended}/{att.appTotal}
                            </p>
                          </div>
                          <div className="rounded-md bg-primary/5 border border-primary/20 p-2">
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">Total</p>
                            <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50">
                              {att.totalAttended}/{att.totalClasses}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>

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
            <CardDescription>Configure class schedule with precise timings for each section</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddTimetableEntry} className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Add Timetable Entry</h3>
              
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Section
                  </label>
                  <Select value={selectedSection} onValueChange={setSelectedSection} disabled={isAddingTimetable}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select section" />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.filter(s => s.active).map(section => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Day
                  </label>
                  <Select value={selectedDay} onValueChange={setSelectedDay} disabled={isAddingTimetable}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map(day => (
                        <SelectItem key={day} value={day}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Subject
                  </label>
                  <Select value={selectedSubject} onValueChange={setSelectedSubject} disabled={isAddingTimetable}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map(subject => (
                        <SelectItem key={subject.id} value={subject.id}>
                          {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Start Time
                  </label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={isAddingTimetable}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    End Time
                  </label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    disabled={isAddingTimetable}
                  />
                </div>

                <div className="flex flex-col justify-end space-y-2">
                  {previewClassCount > 0 && (
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      This period counts as {previewClassCount} class{previewClassCount > 1 ? 'es' : ''}
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={isAddingTimetable || !selectedSection || !selectedSubject || !startTime || !endTime || previewClassCount <= 0}
                    className="w-full"
                  >
                    {isAddingTimetable ? "Adding..." : "Add Entry"}
                  </Button>
                </div>
              </div>
            </form>

            {selectedSection && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Schedule for {sections.find(s => s.id === selectedSection)?.name}
                </h3>
                {WEEKDAYS.map(day => {
                  const dayEntries = timetable
                    .filter(t => t.sectionId === selectedSection && t.day === day)
                    .sort((a, b) => a.order - b.order);

                  return (
                    <div key={day} className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                      <h4 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">{day}</h4>
                      {dayEntries.length === 0 ? (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">No classes scheduled</p>
                      ) : (
                        <div className="space-y-2">
                          {dayEntries.map(entry => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between rounded border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800"
                            >
                              <div className="flex items-center gap-3">
                                <Clock className="h-4 w-4 text-neutral-500" />
                                <div>
                                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                                    {subjects.find(s => s.id === entry.subjectId)?.name || 'Unknown'}
                                  </p>
                                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                                    {entry.startTime} – {entry.endTime}
                                    <span className="ml-2 text-blue-600 dark:text-blue-400">
                                      ({entry.classCount || 1} class{(entry.classCount || 1) > 1 ? 'es' : ''})
                                    </span>
                                  </p>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeleteTimetableEntry(entry.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
      </div>
    </div>
    </PageTransition>
  );
}
