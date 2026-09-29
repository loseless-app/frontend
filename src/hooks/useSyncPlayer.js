import { useState, useEffect, useCallback, useRef } from "react";
import { socket } from "../services/socket.js";

// Hook to join a room and manage real-time playback state
export function useSyncPlayer(
  roomId,
  username,
  sessionId,
  onAssignedUsername,
  isCreating = false,
  onRoomError = null
) {
  const [roomState, setRoomState] = useState(null);

  const usernameRef = useRef(username);
  const sessionIdRef = useRef(sessionId);
  const isCreatingRef = useRef(isCreating);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    isCreatingRef.current = isCreating;
  }, [isCreating]);

  const [isDisplaced, setIsDisplaced] = useState(false);

  // Listen for room state broadcasts
  useEffect(() => {
    const onRoomState = (newRoomState) => setRoomState(newRoomState);
    socket.on("room:state", onRoomState);
    return () => socket.off("room:state", onRoomState);
  }, []);

  // Listen for member join / leave events as defense-in-depth for members list and user counts
  useEffect(() => {
    const onUserJoined = (data) => {
      if (data?.members) {
        setRoomState((prev) => (prev ? { ...prev, members: data.members } : prev));
      }
    };
    const onUserLeft = (data) => {
      if (data?.members) {
        setRoomState((prev) => (prev ? { ...prev, members: data.members } : prev));
      }
    };

    socket.on("room:user_joined", onUserJoined);
    socket.on("room:user_left", onUserLeft);
    return () => {
      socket.off("room:user_joined", onUserJoined);
      socket.off("room:user_left", onUserLeft);
    };
  }, []);

  // Listen for session displaced event (room opened in another tab)
  useEffect(() => {
    const onSessionDisplaced = () => {
      setIsDisplaced(true);
      // Immediately halt local roomState playback so video/audio stops dead in this tab
      setRoomState((prev) => (prev ? { ...prev, isPlaying: false } : prev));
    };
    socket.on("session:displaced", onSessionDisplaced);
    return () => socket.off("session:displaced", onSessionDisplaced);
  }, []);

  // Listen for room join confirmation / auto-disambiguated username
  useEffect(() => {
    const onRoomJoined = (payload) => {
      setIsDisplaced(false);
      if (payload?.username && onAssignedUsername) {
        onAssignedUsername(payload.username);
      }
    };
    socket.on("room:joined", onRoomJoined);
    return () => socket.off("room:joined", onRoomJoined);
  }, [onAssignedUsername]);

  // Listen for room error (e.g. room does not exist when joining)
  useEffect(() => {
    const handleRoomError = (err) => {
      if (onRoomError) {
        onRoomError(err);
      }
    };
    socket.on("room:error", handleRoomError);
    return () => socket.off("room:error", handleRoomError);
  }, [onRoomError]);

  // Connect and join the room once credentials are present (only on roomId or socket connection changes)
  useEffect(() => {
    if (!roomId || !usernameRef.current) return;

    const doJoin = () => {
      socket.emit("room:join", {
        roomId,
        username: usernameRef.current,
        sessionId: sessionIdRef.current,
        isCreating: Boolean(isCreatingRef.current),
      });
      isCreatingRef.current = false;
    };

    if (socket.connected) {
      doJoin();
    } else {
      socket.connect();
    }

    socket.on("connect", doJoin);
    return () => socket.off("connect", doJoin);
  }, [roomId]);

  const emitPlay = useCallback((position) => {
    socket.emit("media:action", { action: "play", position });
  }, []);

  const emitPause = useCallback((position) => {
    socket.emit("media:action", { action: "pause", position });
  }, []);

  const emitSeek = useCallback((position) => {
    socket.emit("media:action", { action: "seek", position });
  }, []);

  const emitChangeSource = useCallback((payload) => {
    // Polymorphic: supports both string URLs ("https://...") and file objects ({ mediaType: "file", mediaMetadata })
    if (typeof payload === "string") {
      socket.emit("media:action", {
        action: "change_source",
        mediaType: "url",
        mediaUrl: payload,
      });
    } else if (payload && typeof payload === "object") {
      socket.emit("media:action", {
        action: "change_source",
        mediaType: payload.mediaType || "url",
        mediaUrl: payload.mediaUrl || "",
        mediaMetadata: payload.mediaMetadata || null,
      });
    }
  }, []);

  const emitBuffering = useCallback((isBuffering) => {
    socket.emit("media:buffering", { isBuffering });
  }, []);

  const reclaimSession = useCallback(() => {
    setIsDisplaced(false);
    if (!roomId || !usernameRef.current) return;

    if (!socket.connected) {
      socket.connect();
    }
    socket.emit("room:join", {
      roomId,
      username: usernameRef.current,
      sessionId: sessionIdRef.current,
    });
  }, [roomId]);

  return {
    roomState,
    isDisplaced,
    reclaimSession,
    emitPlay,
    emitPause,
    emitSeek,
    emitChangeSource,
    emitBuffering,
  };
}