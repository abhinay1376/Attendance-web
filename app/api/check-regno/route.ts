import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const { regNo, phone } = await request.json();

    if (!regNo && !phone) {
      return NextResponse.json({ error: "Missing regNo or phone" }, { status: 400 });
    }

    const result: { regNoExists: boolean; phoneExists: boolean } = {
      regNoExists: false,
      phoneExists: false,
    };

    // Check registration number uniqueness
    if (regNo) {
      const regSnap = await adminDb
        .collection("users")
        .where("regNo", "==", regNo.toLowerCase())
        .limit(1)
        .get();
      result.regNoExists = !regSnap.empty;
    }

    // Check phone number uniqueness
    if (phone) {
      const phoneSnap = await adminDb
        .collection("users")
        .where("phone", "==", phone)
        .limit(1)
        .get();
      result.phoneExists = !phoneSnap.empty;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error checking registration:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
