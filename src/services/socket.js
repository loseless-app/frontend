import { io } from "socket.io-client";

// Backend URL default to localhost:4000 or VITE_SERVER_URL env variable
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// Singleton Socket.io client instance
export const socket = io(SERVER_URL, {
  autoConnect: false, // Explicitly connect when user enters a room
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});
