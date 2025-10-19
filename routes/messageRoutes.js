// routes/chat.js
import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import { createChat, getChat, sendMessage, fetchMessages, fetchLatestChats } from "../controllers/messageController.js";

const router = express.Router();


// Create a new chat
router.post("/chats", verifyToken, createChat);

// Get chat details
router.get("/chats/:chatId", verifyToken, getChat);

// Send a message to a chat
router.post("/chats/:chatId/messages", verifyToken, sendMessage);

// Get messages for a chat
router.get("/chats/:chatId/messages", verifyToken, fetchMessages);

// List all chats for the user
router.get("/chats", verifyToken, fetchLatestChats);

export default router;
