import dotenv from "dotenv";
import CryptoJS from "crypto-js";
import path from "path";
import { fileURLToPath } from "url";


// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from project root
const envPath = path.resolve(__dirname, "../../../.env");
console.log("Attempting to load .env from:", envPath);
dotenv.config({ path: envPath });


// Secure key must be in .env or environment variables
if (!process.env.MESSAGE_SECRET_KEY) {
  throw new Error('MESSAGE_SECRET_KEY is required in environment variables. Message encryption cannot proceed without a secure key.');
}

const SECRET_KEY = process.env.MESSAGE_SECRET_KEY;

export function encryptMessage(text) {

  return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
}

export function decryptMessage(cipherText) {

  const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}
