import admin from "firebase-admin";

// Initialize Firebase Admin SDK (server-side only)
if (!admin.apps.length) {
  // Use service account key from file
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const serviceAccount = require("../serviceAccountKey.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
export default admin;
