/**
 * API Route: Send OTP Email
 * POST /api/send-otp
 * Body: { email: string, type: "registration" | "password-reset" }
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { generateOTP, storeOTP, checkOTPRateLimit } from "@/lib/otp";

const resend = new Resend(process.env.RESEND_API_KEY);

// Timeout wrapper for promises
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    )
  ]);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, type } = body;

    // Validate input
    if (!email || !type) {
      return NextResponse.json(
        { error: "Email and type are required" },
        { status: 400 }
      );
    }

    if (type !== "registration" && type !== "password-reset") {
      return NextResponse.json(
        { error: "Invalid OTP type" },
        { status: 400 }
      );
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.includes('YOUR_API_KEY_HERE')) {
      console.error("Resend API key not configured");
      return NextResponse.json(
        { error: "Email service not configured. Please contact administrator." },
        { status: 500 }
      );
    }

    // Check rate limiting
    const rateLimitCheck = await checkOTPRateLimit(email);
    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        { error: rateLimitCheck.error, waitSeconds: rateLimitCheck.waitSeconds },
        { status: 429 }
      );
    }

    // Generate and store OTP
    const code = generateOTP();
    await storeOTP(email, code, type);

    // Send email via Resend
    const emailSubject =
      type === "registration"
        ? "Verify Your Email - Attendance Tracker"
        : "Reset Your Password - Attendance Tracker";

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailSubject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Attendance Tracker</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px 0; color: #1a1a1a; font-size: 24px; font-weight: 600;">
                ${type === "registration" ? "Verify Your Email" : "Reset Your Password"}
              </h2>
              
              <p style="margin: 0 0 20px 0; color: #4a5568; font-size: 16px; line-height: 1.6;">
                ${type === "registration"
        ? "Thank you for registering! Please use the verification code below to complete your registration:"
        : "We received a request to reset your password. Use the code below to proceed:"
      }
              </p>
              
              <!-- OTP Code -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                <tr>
                  <td align="center" style="background-color: #f7fafc; border: 2px dashed #cbd5e0; border-radius: 8px; padding: 30px;">
                    <div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #667eea; font-family: 'Courier New', monospace;">
                      ${code}
                    </div>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 20px 0 0 0; color: #718096; font-size: 14px; line-height: 1.6;">
                This code will expire in <strong>10 minutes</strong>. If you didn't request this code, please ignore this email.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f7fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #a0aec0; font-size: 12px;">
                This is an automated email from Attendance Tracker. Please do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const emailText = `
${type === "registration" ? "Verify Your Email" : "Reset Your Password"}

${type === "registration"
        ? "Thank you for registering! Please use the verification code below to complete your registration:"
        : "We received a request to reset your password. Use the code below to proceed:"
      }

Your verification code is: ${code}

This code will expire in 10 minutes. If you didn't request this code, please ignore this email.

---
Attendance Tracker
    `;

    // Send email with 10-second timeout
    try {
      await withTimeout(
        resend.emails.send({
          from: "Attendance Tracker <onboarding@resend.dev>", // Update with your verified domain
          to: email,
          subject: emailSubject,
          html: emailHtml,
          text: emailText,
        }),
        10000 // 10 second timeout
      );
    } catch (emailError) {
      console.error("Resend API error:", emailError);
      // Delete the stored OTP since email failed
      // (OTP will auto-expire anyway, but this is cleaner)
      throw new Error("Failed to send email. Please check your Resend API key configuration.");
    }

    return NextResponse.json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch (error) {
    console.error("Error sending OTP:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to send OTP. Please try again.";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
