import { useState, useEffect, useRef, useCallback } from "react";
import { socket } from "../services/socket.js";

// Custom hook to manage real-time Watch Party video synchronization
export function useSyncPlayer(roomId, username) {
  const [roomState, setRoomState] = useState(null);
  const [clockSkew, setClockSkew] = useState(0);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [error, setError] = useState(null);

  // Lock flag to distinguish local user clicks from incoming server broadcasts
  const isRemoteAction = useRef(false);
  const minRttRef = useRef(Infinity);

  // 1. High-Precision Min-RTT NTP Clock Synchronization ping-pong
  useEffect(() => {
    if (!socket.connected) return;

    // Send a burst of 3 pings on initial connection to find the absolute minimum RTT
    const sendPing = () => {
      const clientSendTime = Date.now();
      socket.emit("sync:ping", { clientSendTime });
    };

    // Burst pings on initial mount
    sendPing();
    const burstTimeout1 = setTimeout(sendPing, 200);
    const burstTimeout2 = setTimeout(sendPing, 400);

    const interval = setInterval(sendPing, 8000);

    const handlePong = ({ clientSendTime, serverTime }) => {
      const now = Date.now();
      const rtt = Math.max(1, now - clientSendTime);

      // Only update clock skew if this sample has lower network jitter (lower RTT)
      if (rtt < minRttRef.current || minRttRef.current === Infinity) {
        minRttRef.current = rtt;
        const calculatedSkew = serverTime + rtt / 2 - now;
        setClockSkew(calculatedSkew);
      }
    };

    socket.on("sync:pong", handlePong);

    return () => {
      clearTimeout(burstTimeout1);
      clearTimeout(burstTimeout2);
      clearInterval(interval);
      socket.off("sync:pong", handlePong);
    };
  }, [isConnected]);

  // 2. Room Event Handlers & State Listeners
  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    const onRoomState = (newRoomState) => {
      // Set lock flag so player event handlers know this state came from server
      isRemoteAction.current = true;
      setRoomState(newRoomState);
    };

    const onError = (errPayload) => {
      setError(errPayload?.message || "An unexpected socket error occurred.");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("error", onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("error", onError);
    };
  }, []);

  // 3. Connect socket & Join Room automatically when roomId and username are present
  useEffect(() => {
    if (!roomId || !username) return;

    const doJoin = () => {
      socket.emit("room:join", { roomId, username });
    };

    if (!socket.connected) {
      socket.connect();
    } else {
      doJoin();
    }

    socket.on("connect", doJoin);

    return () => {
      socket.off("connect", doJoin);
    };
  }, [roomId, username]);

  const joinRoom = useCallback(() => {
    if (!roomId || !username) return;
    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit("room:join", { roomId, username });
    }
  }, [roomId, username]);

  // 4. Emit Play Action
  const emitPlay = useCallback((position) => {
    socket.emit("media:action", {
      action: "play",
      position,
    });
  }, []);

  // 5. Emit Pause Action
  const emitPause = useCallback((position) => {
    socket.emit("media:action", {
      action: "pause",
      position,
    });
  }, []);

  // 6. Emit Seek Action
  const emitSeek = useCallback((position) => {
    socket.emit("media:action", {
      action: "seek",
      position,
    });
  }, []);

  // 7. Emit Change Video Source
  const emitChangeSource = useCallback(
    (mediaUrl) => {
      socket.emit("media:action", {
        action: "change_source",
        mediaType: "url",
        mediaUrl,
      });
    },
    []
  );

  // 8. Emit Buffering State Change
  const emitBuffering = useCallback((isBuffering) => {
    socket.emit("media:buffering", { isBuffering });
  }, []);

  return {
    roomState,
    clockSkew,
    isConnected,
    error,
    joinRoom,
    emitPlay,
    emitPause,
    emitSeek,
    emitChangeSource,
    emitBuffering,
  };
}
