/**
 * API Route: Reset Password with OTP
 * POST /api/reset-password
 * Body: { email: string, otp: string, newPassword: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { validateOTP } from "@/lib/otp";
import { adminAuth } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { email, otp, newPassword } = body;

        // Validate input
        if (!email || !otp || !newPassword) {
            return NextResponse.json(
                { error: "Email, OTP, and new password are required" },
                { status: 400 }
            );
        }

        if (newPassword.length < 6) {
            return NextResponse.json(
                { error: "Password must be at least 6 characters" },
                { status: 400 }
            );
        }

        // Validate OTP
        const otpResult = await validateOTP(email, otp);
        if (!otpResult.valid) {
            return NextResponse.json(
                { error: otpResult.error || "Invalid OTP" },
                { status: 400 }
            );
        }

        // Get user by email
        const userRecord = await adminAuth.getUserByEmail(email);

        // Update password using Firebase Admin SDK
        await adminAuth.updateUser(userRecord.uid, {
            password: newPassword,
        });

        return NextResponse.json({
            success: true,
            message: "Password reset successfully",
        });
    } catch (error: any) {
        console.error("Error resetting password:", error);

        if (error.code === "auth/user-not-found") {
            return NextResponse.json(
                { error: "No account found with this email" },
                { status: 404 }
            );
        }

        return NextResponse.json(
            { error: "Failed to reset password. Please try again." },
            { status: 500 }
        );
    }
}
