import { io } from "socket.io-client";

// Backend URL from env (VITE_ prefix is required for Vite to expose it), falling back to localhost
const SERVER_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

// Singleton Socket.io client instance
export const socket = io(SERVER_URL, {
  autoConnect: true, // Connect on load so the app always knows the server status
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity, // Keep retrying so the app recovers when the server returns
  reconnectionDelay: 1000,
});
