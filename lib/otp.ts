/**
 * OTP Utility Functions
 * Handles OTP generation, storage, validation, and rate limiting
 * Uses Firebase Admin SDK for server-side operations
 */

import { adminDb } from "./firebase-admin";

export interface OTPRecord {
  code: string;
  email: string;
  type: "registration" | "password-reset";
  expiresAt: number;
  attempts: number;
  createdAt: number;
}

export interface OTPRateLimit {
  email: string;
  lastSentAt: number;
  sendCount: number;
}

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_SENDS_PER_HOUR = 5;

/**
 * Generate a 6-digit numeric OTP
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Store OTP in Firestore with expiry
 */
export async function storeOTP(
  email: string,
  code: string,
  type: "registration" | "password-reset"
): Promise<void> {
  const now = Date.now();

  await adminDb.collection("otpCodes").doc(email).set({
    code,
    email,
    type,
    expiresAt: now + OTP_EXPIRY_MS,
    attempts: 0,
    createdAt: now,
  });
}

/**
 * Validate OTP against stored value
 * Returns { valid: boolean, error?: string }
 */
export async function validateOTP(
  email: string,
  code: string
): Promise<{ valid: boolean; error?: string }> {
  const otpRef = adminDb.collection("otpCodes").doc(email);
  const otpSnap = await otpRef.get();

  if (!otpSnap.exists) {
    return { valid: false, error: "No OTP found. Please request a new one." };
  }

  const otpData = otpSnap.data() as OTPRecord;
  const now = Date.now();

  // Check expiry
  if (now > otpData.expiresAt) {
    await otpRef.delete();
    return { valid: false, error: "OTP has expired. Please request a new one." };
  }

  // Check attempts
  if (otpData.attempts >= MAX_ATTEMPTS) {
    await otpRef.delete();
    return { valid: false, error: "Too many failed attempts. Please request a new OTP." };
  }

  // Check code
  if (otpData.code !== code) {
    // Increment attempts
    await otpRef.update({ attempts: otpData.attempts + 1 });
    const remaining = MAX_ATTEMPTS - (otpData.attempts + 1);
    return {
      valid: false,
      error: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
    };
  }

  // Valid OTP - delete it so it can't be reused
  await otpRef.delete();
  return { valid: true };
}

/**
 * Check if user can request a new OTP (rate limiting)
 * Returns { allowed: boolean, error?: string, waitSeconds?: number }
 */
export async function checkOTPRateLimit(
  email: string
): Promise<{ allowed: boolean; error?: string; waitSeconds?: number }> {
  const rateLimitRef = adminDb.collection("otpRateLimits").doc(email);
  const rateLimitSnap = await rateLimitRef.get();
  const now = Date.now();

  if (!rateLimitSnap.exists) {
    // First time sending OTP
    await rateLimitRef.set({
      email,
      lastSentAt: now,
      sendCount: 1,
    });
    return { allowed: true };
  }

  const rateLimitData = rateLimitSnap.data() as OTPRateLimit;

  // Check cooldown (60 seconds between sends)
  const timeSinceLastSend = now - rateLimitData.lastSentAt;
  if (timeSinceLastSend < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - timeSinceLastSend) / 1000);
    return {
      allowed: false,
      error: `Please wait ${waitSeconds} second${waitSeconds !== 1 ? "s" : ""} before requesting a new OTP.`,
      waitSeconds,
    };
  }

  // Check hourly limit (5 sends per hour)
  const oneHourAgo = now - 60 * 60 * 1000;
  if (rateLimitData.lastSentAt > oneHourAgo && rateLimitData.sendCount >= MAX_SENDS_PER_HOUR) {
    return {
      allowed: false,
      error: "Too many OTP requests. Please try again later.",
    };
  }

  // Update rate limit
  const newSendCount = rateLimitData.lastSentAt > oneHourAgo ? rateLimitData.sendCount + 1 : 1;
  await rateLimitRef.set({
    email,
    lastSentAt: now,
    sendCount: newSendCount,
  });

  return { allowed: true };
}

/**
 * Clean up expired OTPs and old rate limits (call periodically or via Cloud Function)
 */
export async function cleanupExpiredOTPs(): Promise<void> {
  // This would typically be done via a Cloud Function scheduled task
  // For now, it's a utility function that can be called manually
  // Implementation would query all OTP docs and delete expired ones
  console.log("OTP cleanup would run here");
}
