import { useState, useEffect, useCallback } from "react";
import { socket } from "../services/socket.js";

// Hook for live room chat: loads history on join and streams new messages
export function useChat(roomId) {
  const [messages, setMessages] = useState([]);

  // Load persisted history when the room changes
  useEffect(() => {
    const onHistory = (history) => setMessages(history || []);
    socket.on("chat:history", onHistory);
    return () => socket.off("chat:history", onHistory);
  }, [roomId]);

  // Stream live messages (broadcast echo includes the sender's own message)
  useEffect(() => {
    const onMessage = (message) => {
      if (!message) return;
      setMessages((prev) => {
        if (message.id && prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
    };
    socket.on("chat:message", onMessage);
    return () => socket.off("chat:message", onMessage);
  }, []);

  const sendMessage = useCallback((text) => {
    const clean = text.trim();
    if (!clean) return;
    socket.emit("chat:message", { text: clean });
  }, []);

  return { messages, sendMessage };
}