import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { ADMIN_EMAIL } from "@/lib/constants";

const BATCH_SIZE = 400; // keep safely under Firestore's 500-op limit

export async function POST(request: NextRequest) {
  try {
    const { date, reason, adminToken } = await request.json();

    // ── 1. Input validation ──────────────────────────────────────────
    if (!date || !reason || !adminToken) {
      return NextResponse.json(
        { error: "Missing required fields: date, reason, adminToken" },
        { status: 400 }
      );
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }

    // ── 2. Verify admin identity ─────────────────────────────────────
    const adminAuth = getAdminAuth();
    const decodedToken = await adminAuth.verifyIdToken(adminToken);
    if (decodedToken.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const db = getAdminDb();

    // ── 3. Guard against duplicate holiday ───────────────────────────
    const holidayRef = db.collection("holidays").doc(date);
    const existing = await holidayRef.get();
    if (existing.exists) {
      return NextResponse.json(
        { error: `Date ${date} is already marked as a holiday` },
        { status: 409 }
      );
    }

    // ── 4. Fetch all student UIDs ────────────────────────────────────
    // We query the users collection for approved students only.
    // Non-approved students technically cannot mark attendance, but we
    // include them defensively to handle any edge-case stale records.
    const usersSnapshot = await db.collection("users").get();
    const studentUids = usersSnapshot.docs.map((d) => d.id);

    // ── 5. Collect all attendance docs for this date ─────────────────
    // Path: attendance/{uid}/dates/{date}
    const attendanceRefs: FirebaseFirestore.DocumentReference[] = [];
    for (const uid of studentUids) {
      const ref = db
        .collection("attendance")
        .doc(uid)
        .collection("dates")
        .doc(date);
      attendanceRefs.push(ref);
    }

    // ── 6. Delete in batches of BATCH_SIZE ───────────────────────────
    // We first check which docs actually exist to avoid unnecessary writes
    // and get an accurate deleted count.
    let deletedCount = 0;

    for (let i = 0; i < attendanceRefs.length; i += BATCH_SIZE) {
      const chunk = attendanceRefs.slice(i, i + BATCH_SIZE);

      // Bulk-read to find which ones exist
      const snapshots = await db.getAll(...chunk);
      const toDelete = snapshots.filter((s) => s.exists);

      if (toDelete.length === 0) continue;

      const batch = db.batch();
      for (const snap of toDelete) {
        batch.delete(snap.ref);
        deletedCount++;
      }
      await batch.commit();
    }

    // ── 7. Write the holiday document ────────────────────────────────
    await holidayRef.set({
      reason: reason.trim(),
      createdAt: Date.now(),
      markedBy: decodedToken.email,
      attendanceDeletedCount: deletedCount,
    });

    // ── 8. Audit log ─────────────────────────────────────────────────
    await db.collection("auditLog").add({
      action: "HOLIDAY_CREATED",
      date,
      reason: reason.trim(),
      performedBy: decodedToken.email,
      attendanceRecordsDeleted: deletedCount,
      timestamp: Date.now(),
    });

    return NextResponse.json({
      success: true,
      message: `Holiday marked. ${deletedCount} attendance record(s) deleted.`,
      date,
      attendanceDeleted: deletedCount,
    });
  } catch (error) {
    console.error("Error in mark-holiday API:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
