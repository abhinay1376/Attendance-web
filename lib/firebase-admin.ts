import admin from "firebase-admin";

// Initialize Firebase Admin SDK (server-side only)
function initializeFirebaseAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin SDK not initialized: missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY env vars"
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
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
