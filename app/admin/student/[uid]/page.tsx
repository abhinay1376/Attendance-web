"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer } from "@/components/ui/chart";
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { ArrowLeft, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Types ─── */
interface AttendanceRecord {
  subjectId: string;
  status: "PRESENT" | "ABSENT";
  classCount?: number;
  timestamp: number;
}

type DateRecords = Record<string, Record<string, AttendanceRecord>>;

interface StudentInfo {
  name?: string;
  email?: string;
  regNo?: string;
  section?: string;
  sectionId?: string;
  initialAttendance?: { attended: number; total: number };
}

type FilterKey = "all" | "monthly" | "daily";

/* ─── Helpers ─── */
function sumSlots(slots: Record<string, AttendanceRecord>) {
  let p = 0, a = 0;
  Object.values(slots).forEach((r) => {
    const c = r.classCount || 1;
    r.status === "PRESENT" ? (p += c) : (a += c);
  });
  return { p, a };
}

function filterRecords(raw: DateRecords, filter: FilterKey): DateRecords {
  const today = new Date();
  if (filter === "daily") {
    const todayStr = format(today, "yyyy-MM-dd");
    return Object.fromEntries(Object.entries(raw).filter(([d]) => d === todayStr));
  }
  if (filter === "monthly") {
    const prefix = format(today, "yyyy-MM");
    return Object.fromEntries(Object.entries(raw).filter(([d]) => d.startsWith(prefix)));
  }
  return raw;
}

function computeSubjectStats(records: DateRecords) {
  const sm: Record<string, { p: number; a: number }> = {};
  Object.values(records).forEach((slots) =>
    Object.values(slots).forEach((r) => {
      const c = r.classCount || 1;
      if (!sm[r.subjectId]) sm[r.subjectId] = { p: 0, a: 0 };
      r.status === "PRESENT" ? (sm[r.subjectId].p += c) : (sm[r.subjectId].a += c);
    })
  );
  return Object.entries(sm)
    .map(([subject, { p, a }]) => ({
      subject,
      present: p,
      absent: a,
      total: p + a,
      percentage: p + a > 0 ? Math.round((p / (p + a)) * 100) : 0,
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

/* ─── Component ─── */
export default function AdminStudentPage() {
  const params = useParams();
  const router = useRouter();
  const uid = params.uid as string;

  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [rawDateRecords, setRawDateRecords] = useState<DateRecords>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const [userSnap, dateSnap] = await Promise.all([
          getDoc(doc(db, "users", uid)),
          getDocs(collection(db, "attendance", uid, "dates")),
        ]);
        if (userSnap.exists()) setStudent(userSnap.data() as StudentInfo);
        const raw: DateRecords = {};
        dateSnap.forEach((d) => {
          const data = d.data() as Record<string, AttendanceRecord>;
          if (Object.keys(data).length > 0) raw[d.id] = data;
        });
        setRawDateRecords(raw);
      } finally {
        setDataLoading(false);
      }
    })();
  }, [uid]);

  const filteredRecords = useMemo(() => filterRecords(rawDateRecords, filter), [rawDateRecords, filter]);
  const subjectStats = useMemo(() => computeSubjectStats(filteredRecords), [filteredRecords]);

  const { appAtt, appTot } = useMemo(() => {
    let att = 0, tot = 0;
    Object.values(rawDateRecords).forEach((slots) =>
      Object.values(slots).forEach((r) => {
        const c = r.classCount || 1; tot += c;
        if (r.status === "PRESENT") att += c;
      })
    );
    return { appAtt: att, appTot: tot };
  }, [rawDateRecords]);

  const { filtAtt, filtTot } = useMemo(() => {
    let att = 0, tot = 0;
    Object.values(filteredRecords).forEach((slots) =>
      Object.values(slots).forEach((r) => {
        const c = r.classCount || 1; tot += c;
        if (r.status === "PRESENT") att += c;
      })
    );
    return { filtAtt: att, filtTot: tot };
  }, [filteredRecords]);

  const initAtt = student?.initialAttendance?.attended ?? 0;
  const initTot = student?.initialAttendance?.total ?? 0;
  const totalAtt = initAtt + appAtt;
  const totalTot = initTot + appTot;
  const overallPct = totalTot > 0 ? Math.round((totalAtt / totalTot) * 100) : 0;
  const filtPct = filtTot > 0 ? Math.round((filtAtt / filtTot) * 100) : 0;

  const donutClr = overallPct >= 75 ? "#4f46e5" : overallPct >= 50 ? "#d97706" : "#dc2626";

  const subjectChartConfig = { percentage: { label: "Attendance %", color: "#4f46e5" } };

  const filterTabs: { key: FilterKey; label: string }[] = [
    { key: "all",     label: "All Time"   },
    { key: "monthly", label: "This Month" },
    { key: "daily",   label: "Today"      },
  ];

  if (dataLoading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header skeleton */}
        <div className="sticky top-0 z-30 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 h-14 flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        {/* Content skeleton */}
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          {/* Filter tabs skeleton */}
          <div className="flex gap-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-24 rounded-lg" />)}
          </div>
          {/* Stat cards skeleton */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
          {/* Donut + subject chart skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-4">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-48 w-48 rounded-full mx-auto" />
            </div>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-4">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-base font-bold leading-tight">{student?.name || "Student"}</h1>
            <p className="text-[11px] text-neutral-500 leading-tight">
              {student?.regNo}{student?.section ? ` · ${student.section}` : student?.sectionId ? ` · ${student.sectionId}` : ""}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 space-y-5">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-950 w-fit">
          {filterTabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-xs font-medium transition-all select-none",
                filter === key
                  ? "bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: filter === "all" ? "Overall" : filterTabs.find((t) => t.key === filter)!.label,
              value: filter === "all" ? (totalTot > 0 ? `${overallPct}%` : "N/A") : (filtTot > 0 ? `${filtPct}%` : "N/A"),
              sub: filter === "all" ? `${totalAtt}/${totalTot}` : `${filtAtt}/${filtTot}`,
              color: "text-indigo-600",
            },
            {
              label: "Before App",
              value: initTot > 0 ? `${Math.round((initAtt / initTot) * 100)}%` : "N/A",
              sub: `${initAtt}/${initTot}`,
              color: "text-sky-600",
            },
            {
              label: "Via App",
              value: appTot > 0 ? `${Math.round((appAtt / appTot) * 100)}%` : "N/A",
              sub: `${appAtt}/${appTot}`,
              color: "text-violet-600",
            },
            {
              label: "Subjects",
              value: `${subjectStats.length}`,
              sub: "tracked",
              color: "text-teal-600",
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

        {/* Donut + Subject progress */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card className="md:col-span-2">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Overall Attendance</CardTitle>
              <CardDescription className="text-xs">Initial + app-tracked combined</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative h-[178px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Present", value: totalAtt },
                        { name: "Absent",  value: Math.max(0, totalTot - totalAtt) },
                      ]}
                      cx="50%" cy="50%" innerRadius={52} outerRadius={74}
                      paddingAngle={totalTot > 0 ? 3 : 0}
                      dataKey="value" startAngle={90} endAngle={-270} strokeWidth={0}
                    >
                      <Cell fill={donutClr} />
                      <Cell fill="#f1f5f9" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl font-bold tabular-nums text-neutral-800 dark:text-neutral-100">
                    {totalTot > 0 ? `${overallPct}%` : "—"}
                  </span>
                  <span className="text-[11px] text-neutral-400 mt-0.5">overall</span>
                </div>
              </div>
              <div className="flex justify-center gap-4 mt-1 text-xs text-neutral-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full inline-block" style={{ background: donutClr }} />Present ({totalAtt})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-slate-200 inline-block" />Absent ({Math.max(0, totalTot - totalAtt)})
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-3">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Subject-wise Progress</CardTitle>
              <CardDescription className="text-xs">
                {filter === "all" ? "All time attendance per subject" : filterTabs.find((t) => t.key === filter)!.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {subjectStats.length === 0 ? (
                <div className="py-10 text-center text-xs text-neutral-400">No data for this period</div>
              ) : (
                <div className="space-y-2.5 max-h-[205px] overflow-y-auto pr-1">
                  {subjectStats.map((s) => (
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

        {/* Subject percentage bar chart */}
        {subjectStats.length > 0 && (
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-neutral-400" />
                Attendance % by Subject
              </CardTitle>
              <CardDescription className="text-xs">Hover a point for present / absent / total class details</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <ChartContainer config={subjectChartConfig} height={260}>
                <LineChart
                  data={[...subjectStats].sort((a, b) => a.subject.localeCompare(b.subject))}
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
                  {/* 75% threshold reference line */}
                  <CartesianGrid y={75} stroke="#4f46e533" strokeDasharray="4 4" vertical={false} />
                  <Tooltip
                    cursor={{ stroke: "#e2e8f0", strokeWidth: 1 }}
                    content={(props) => {
                      if (!props.active || !props.payload?.length) return null;
                      const d = props.payload[0]?.payload as typeof subjectStats[0];
                      return (
                        <div className="rounded-xl border border-neutral-200/80 bg-white px-3.5 py-2.5 shadow-lg text-xs min-w-[170px] dark:border-neutral-800 dark:bg-neutral-950">
                          <p className="mb-2 font-semibold text-[11px] uppercase tracking-wide text-neutral-500">{d.subject}</p>
                          <div className="space-y-1.5">
                            <div className="flex justify-between gap-4">
                              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-indigo-600 inline-block" />Present</span>
                              <span className="font-semibold">{d.present}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-200 inline-block" />Absent</span>
                              <span className="font-semibold">{d.absent}</span>
                            </div>
                            <div className="border-t border-neutral-100 dark:border-neutral-800 pt-1.5 flex justify-between gap-4">
                              <span className="text-neutral-500">Total</span>
                              <span className="font-semibold">{d.total}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-neutral-500">Attendance</span>
                              <span className={cn("font-bold", d.percentage >= 75 ? "text-indigo-600" : d.percentage >= 50 ? "text-amber-600" : "text-rose-600")}>
                                {d.percentage}%
                              </span>
                            </div>
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

      </div>
    </div>
  );
}
