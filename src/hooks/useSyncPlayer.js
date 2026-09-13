import { useState, useEffect, useCallback } from "react";
import { socket } from "../services/socket.js";

// Hook to join a room and manage real-time playback state
export function useSyncPlayer(roomId, username) {
  const [roomState, setRoomState] = useState(null);

  // Listen for room state broadcasts
  useEffect(() => {
    const onRoomState = (newRoomState) => setRoomState(newRoomState);
    socket.on("room:state", onRoomState);
    return () => socket.off("room:state", onRoomState);
  }, []);

  // Connect and join the room once credentials are present
  useEffect(() => {
    if (!roomId || !username) return;

    const doJoin = () => socket.emit("room:join", { roomId, username });

    if (socket.connected) {
      doJoin();
    } else {
      socket.connect();
    }

    socket.on("connect", doJoin);
    return () => socket.off("connect", doJoin);
  }, [roomId, username]);

  const emitPlay = useCallback((position) => {
    socket.emit("media:action", { action: "play", position });
  }, []);

  const emitPause = useCallback((position) => {
    socket.emit("media:action", { action: "pause", position });
  }, []);

  const emitSeek = useCallback((position) => {
    socket.emit("media:action", { action: "seek", position });
  }, []);

  const emitChangeSource = useCallback((mediaUrl) => {
    socket.emit("media:action", {
      action: "change_source",
      mediaType: "url",
      mediaUrl,
    });
  }, []);

  const emitBuffering = useCallback((isBuffering) => {
    socket.emit("media:buffering", { isBuffering });
  }, []);

  return {
    roomState,
    emitPlay,
    emitPause,
    emitSeek,
    emitChangeSource,
    emitBuffering,
  };
}