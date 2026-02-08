const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa) });

const email = process.argv[2] || "24091a3299@rgmcet.edu.in";
admin.auth().getUserByEmail(email)
  .then(u => admin.auth().deleteUser(u.uid).then(() => console.log("Deleted orphaned auth user:", u.uid, email)))
  .catch(e => console.log("User not found or already deleted:", e.message));
