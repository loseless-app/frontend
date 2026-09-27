import { useState, useEffect, useRef } from "react";
import { socket } from "../services/socket.js";

// Grace period (ms) to debounce momentary transport reconnects (e.g. back/forward navigation, reload)
const DOWN_DEBOUNCE_MS = 1500;

// Returns true while the backend server is unreachable
export function useServerStatus() {
  const [serverDown, setServerDown] = useState(false);
  const downTimerRef = useRef(null);

  useEffect(() => {
    const clearTimer = () => {
      if (downTimerRef.current) {
        clearTimeout(downTimerRef.current);
        downTimerRef.current = null;
      }
    };

    const scheduleServerDown = () => {
      // Do not reschedule if already waiting to declare server down
      if (!downTimerRef.current) {
        downTimerRef.current = setTimeout(() => {
          setServerDown(true);
          downTimerRef.current = null;
        }, DOWN_DEBOUNCE_MS);
      }
    };

    const onConnect = () => {
      clearTimer();
      setServerDown(false);
    };

    const onConnectError = () => {
      scheduleServerDown();
    };

    const onDisconnect = (reason) => {
      // "io server disconnect" means the server closed the connection intentionally
      if (reason !== "io server disconnect") {
        scheduleServerDown();
      }
    };

    // If socket is disconnected on mount, start debounce timer
    if (!socket.connected) {
      scheduleServerDown();
    }

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);

    return () => {
      clearTimer();
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return serverDown;
}