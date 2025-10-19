
import { admin } from "../firebaseAdmin.js";
import { encryptMessage, decryptMessage } from "./messageEncryptionController.js";

const db = admin.firestore();
const DEFAULT_PAGE_SIZE = 20;
const PENPAL_DELAY = 60 * 1000; // 1 minute

// Helper to get milliseconds from either Firestore Timestamp, JS Date, or number
function getMillis(ts) {
  if (ts == null) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return null;
}

// POST /chats — Create a new chat
export async function createChat(req, res) {
  const { participants, type } = req.body;
  if (!Array.isArray(participants) || participants.length !== 2) {
    return res.status(400).json({ success: false, error: "Exactly two participants required" });
  }
  const sortedUids = participants.map(p => p.uid).sort();
  const participantUids = participants.map(p => p.uid);
  
  try {
    // Find existing chat with exactly these two participants
    const snapshot = await db.collection("chats")
      .where("participantUids", "array-contains", sortedUids[0])
      .get();
      
    let existingChat = null;
    snapshot.forEach(doc => {
      const chat = doc.data();
      if (Array.isArray(chat.participantUids) && chat.participantUids.length === 2) {
        const chatUids = chat.participantUids.slice().sort();
        if (chatUids[0] === sortedUids[0] && chatUids[1] === sortedUids[1]) {
          existingChat = { id: doc.id, ...chat };
        }
      }
    });
    
    if (existingChat) {
      return res.status(200).json({ success: true, chatId: existingChat.id, chat: existingChat });
    }
    
    // No existing chat, create new
    const newChatRef = await db.collection("chats").add({
      participants,
      participantUids,
      lastUpdated: new Date(),
      lastMessage: null,
      type: type || "penpal",
      
    });
    
    const chatDoc = await newChatRef.get();
    res.status(201).json({ success: true, chatId: chatDoc.id, chat: chatDoc.data() });
  } catch (err) {
    console.error("Create chat error:", err);
    res.status(500).json({ success: false, error: "Failed to create chat" });
  }
}

// POST /chats/:chatId/messages — Send a message to a chat
export async function sendMessage(req, res) {
  const { chatId } = req.params;
  const { text } = req.body;
  const senderId = req.user.uid;
  if (!text) return res.status(400).json({ success: false, error: "Text is required" });
  try {
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) return res.status(404).json({ success: false, error: "Chat not found" });

    // Prevent multiple messages for "onetime" chat
    const chatData = chatDoc.data();

    if (chatData.type === "onetime") {
        const messagesSnapshot = await db
          .collection("chats")
          .doc(chatId)
          .collection("messages")
          .limit(1)
          .get();

          if (!messagesSnapshot.empty) {
              return res.status(403).json({
                success: false,
                error: "Can't send multiple messages to a one-time chat.",
              });
            }
    }

    const encryptedText = encryptMessage(text);
    const message = {
      senderId,
      text: encryptedText,
      timestamp: new Date(),
    };
    
    await db.collection("chats").doc(chatId).collection("messages").add(message);
    await db.collection("chats").doc(chatId).update({
      lastMessage: { senderId, text: encryptedText, timestamp: new Date(), status: 'unread' },
      lastUpdated: new Date(),
    });
    res.json({ success: true, message: { ...message, text }, chatId, type: chatData.type });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ success: false, error: "Failed to send message" });
  }
}

// GET /chats/:chatId/messages — Get messages for a chat
export async function fetchMessages(req, res) {
  const { chatId } = req.params;
  const currentUserId = req.user.uid;
  const pageSize = parseInt(req.query.pageSize) || DEFAULT_PAGE_SIZE;
  const pageToken = req.query.pageToken || null;
  try {
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) return res.status(404).json({ success: false, messages: [], nextPageToken: null });
    // If the chat has a lastMessage that's unread and was sent by the other user,
    // mark it as read now because the current user is fetching messages.
    const chatData = chatDoc.data();
    if (chatData && chatData.lastMessage && chatData.lastMessage.status !== 'read') {
      const lastMsg = chatData.lastMessage;
      // Only update if the last message was sent by someone else (not current user)
      if (lastMsg.senderId && lastMsg.senderId !== currentUserId) {
        try {
          await db.collection('chats').doc(chatId).update({ 'lastMessage.status': 'read' });
          // update local copy so returned chat state (if used) reflects change
          chatData.lastMessage.status = 'read';
        } catch (err) {
          console.error('Failed to update lastMessage status to read:', err);
          // non-fatal — continue to fetch messages
        }
      }
    }
    let messagesRef = db.collection("chats").doc(chatId).collection("messages").orderBy("timestamp", "desc").limit(pageSize + 1);
    if (pageToken) messagesRef = messagesRef.startAfter(new Date(Number(pageToken)));
    const snapshot = await messagesRef.get();
    const now = Date.now();
    
    let messages = snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        ...data, 
        id: doc.id, 
        text: data.text ? decryptMessage(data.text) : null 
      };
    }).filter(msg => {
      const ts = getMillis(msg.timestamp);
      return msg.senderId === currentUserId || (ts !== null && now - ts >= PENPAL_DELAY);
    });
    
    let nextPageToken = null;
    if (messages.length > pageSize) {
      const lastMsg = messages[pageSize - 1];
      nextPageToken = getMillis(lastMsg.timestamp);
      messages = messages.slice(0, pageSize);
    }
    res.json({ success: true, messages: messages.reverse(), nextPageToken });
  } catch (err) {
    console.error("Fetch messages error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch messages" });
  }
}

// GET /chats — List all chats for the user
export async function fetchLatestChats(req, res) {
  const currentUserId = req.user.uid;
  const pageSize = parseInt(req.query.pageSize) || DEFAULT_PAGE_SIZE;
  const pageToken = req.query.pageToken || null;
  try {
    let chatsRef = db.collection("chats").where("participantUids", "array-contains", currentUserId).orderBy("lastUpdated", "desc").limit(pageSize + 1);
    if (pageToken) chatsRef = chatsRef.startAfter(new Date(Number(pageToken)));
    const snapshot = await chatsRef.get();
    let docs = snapshot.docs;
    
    let nextPageToken = null;
    if (docs.length > pageSize) {
      nextPageToken = docs[pageSize - 1].data().lastUpdated.toMillis();
      docs = docs.slice(0, pageSize);
    }
    
    const chats = docs.map(doc => {
      const data = doc.data();
      const lastMessage = data.lastMessage ? {
        ...data.lastMessage,
        text: decryptMessage(data.lastMessage.text),
        status: data.lastMessage.status,
      } : null;
      return {
        chatId: doc.id,
        participants: data.participants,
        lastUpdated: data.lastUpdated,
        lastMessage,
        type: data.type
      };
    });
    
    res.json({ success: true, chats, nextPageToken });
  } catch (err) {
    console.error("Fetch latest chats error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch latest chats" });
  }
}
// GET /chats/:chatId — Get chat details
export async function getChat(req, res) {
  const { chatId } = req.params;
  try {
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) return res.status(404).json({ success: false, error: "Chat not found" });
    const data = chatDoc.data();
    res.json({ success: true, chatId, chat: data });
  } catch (err) {
    console.error("Get chat error:", err);
    res.status(500).json({ success: false, error: "Failed to get chat" });
  }
}

// DELETE /chats/:chatId — Delete a chat
export async function deleteChat(req, res) {
  const { chatId } = req.params;
  try {
    const chatRef = db.collection("chats").doc(chatId);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) {
      return res.status(404).json({ success: false, error: "Chat not found" });
    }

    // Delete all messages
    const messagesSnapshot = await chatRef.collection("messages").get();
    const batch = db.batch();
    messagesSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // Delete the chat doc
    await chatRef.delete();

    res.json({ success: true });
  } catch (err) {
    console.error("Delete chat error:", err);
    res.status(500).json({ success: false, error: "Failed to delete chat" });
  }
}