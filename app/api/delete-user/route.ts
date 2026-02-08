import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { ADMIN_EMAIL } from "@/lib/constants";

export async function POST(request: NextRequest) {
  try {
    const { uid, adminToken } = await request.json();

    if (!uid || !adminToken) {
      return NextResponse.json({ error: "Missing uid or adminToken" }, { status: 400 });
    }

    // Verify the admin token
    const decodedToken = await adminAuth.verifyIdToken(adminToken);
    if (decodedToken.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Don't allow deleting the admin account
    const targetUser = await adminAuth.getUser(uid);
    if (targetUser.email === ADMIN_EMAIL) {
      return NextResponse.json({ error: "Cannot delete admin account" }, { status: 403 });
    }

    // Delete the user from Firebase Authentication
    await adminAuth.deleteUser(uid);

    return NextResponse.json({ success: true, message: "User deleted from Authentication" });
  } catch (error) {
    console.error("Error deleting user from auth:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
