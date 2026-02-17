import admin from "firebase-admin";

// Initialize Firebase Admin SDK (server-side only)
function initializeFirebaseAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;

  const missing: string[] = [];
  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!rawKey) missing.push("FIREBASE_PRIVATE_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Firebase Admin SDK not initialized: missing ${missing.join(", ")} env var(s)`
    );
  }

  // Handle private key — Vercel may store it with literal \n or with actual newlines
  // Also handle cases where it might be JSON-encoded (wrapped in quotes)
  let privateKey = rawKey!;
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = JSON.parse(privateKey);
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  admin.initializeApp({
    credential: admin.credential.cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey }),
  });
}

export function getAdminAuth() {
  initializeFirebaseAdmin();
  return admin.auth();
}

export function getAdminDb() {
  initializeFirebaseAdmin();
  return admin.firestore();
}

// Lazy getters — safe to import without crashing at module load time
export const adminAuth = new Proxy({} as admin.auth.Auth, {
  get(_, prop) {
    return Reflect.get(getAdminAuth(), prop);
  },
});

export const adminDb = new Proxy({} as admin.firestore.Firestore, {
  get(_, prop) {
    return Reflect.get(getAdminDb(), prop);
  },
});

export default admin;
