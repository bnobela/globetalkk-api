import express from "express";
import chatRoutes from "./routes/messageRoutes.js";
import cors from "cors";

const app = express(); // <-- define app first

// Enable CORS
app.use(cors());

// JSON parser
app.use(express.json());

// Routes
app.use("/api/chat", chatRoutes);

// Test route
app.get("/", (req, res) => res.send("Server is alive!"));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
