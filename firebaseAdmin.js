import admin from "firebase-admin";

// Only load dotenv in local development
if (process.env.NODE_ENV !== "production") {
  import("dotenv").then(dotenv => dotenv.config());
}

if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT not set in environment");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("✅ Firebase Admin initialized");
}

export { admin };
