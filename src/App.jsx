import React, { useState, useEffect, useRef, useCallback } from "react";
import { Minimize2 } from "lucide-react";
import { useSyncPlayer } from "./hooks/useSyncPlayer.js";
import { useChat } from "./hooks/useChat.js";
import { useServerStatus } from "./hooks/useServerStatus.js";
import { useMediaTitle } from "./hooks/useMediaTitle.js";
import { useMediaQuery } from "./hooks/useMediaQuery.js";
import { useLocalMedia } from "./hooks/useLocalMedia.js";
import { useP2PTransfer } from "./features/p2p-transfer/hooks/useP2PTransfer.js";
import {
  cleanupAllOPFSFiles,
  cleanupOPFSFile,
  findOPFSFile,
  getOPFSFileHandle,
  sanitizeSuggestedName,
} from "./features/p2p-transfer/index.js";
import { SidebarTransferPanel } from "./features/p2p-transfer/components/index.js";
import { UnifiedPlayer } from "./components/UnifiedPlayer.jsx";
import { LinkInput } from "./components/LinkInput.jsx";
import { ChatPanel } from "./components/ChatPanel.jsx";
import { ServerStatus } from "./components/ServerStatus.jsx";
import { PickFileButton } from "./components/PickFileButton.jsx";
import { RoomInfoBox } from "./components/RoomInfoBox.jsx";
import { VyncLogo } from "./components/VyncLogo.jsx";
import { DisplacedSessionModal } from "./components/DisplacedSessionModal.jsx";
import { socket } from "./services/socket.js";
import { generateRoomId } from "./utils/roomUtils.js";
import { RoomCodeInput } from "./components/RoomCodeInput.jsx";
import { getRoomIdFromUrl, syncUrlWithRoom } from "./utils/urlUtils.js";

const SESSION_STORAGE_KEY = "vync_session";
const SESSION_PLAYING_FILE_KEY = "lossless_playing_file";

function getSavedPlayingFile() {
  try {
    const raw = sessionStorage.getItem(SESSION_PLAYING_FILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setSavedPlayingFile(roomId, file) {
  try {
    if (!roomId || !file) {
      sessionStorage.removeItem(SESSION_PLAYING_FILE_KEY);
      return;
    }
    sessionStorage.setItem(
      SESSION_PLAYING_FILE_KEY,
      JSON.stringify({
        roomId: String(roomId).trim().toUpperCase(),
        fileName: file.name,
        fileSize: file.size,
      })
    );
  } catch (err) {
    console.warn("[App] Failed to save playing file to sessionStorage:", err);
  }
}

function clearSavedPlayingFile() {
  try {
    sessionStorage.removeItem(SESSION_PLAYING_FILE_KEY);
  } catch { }
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getSavedSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.roomId === "string" && typeof parsed.username === "string") {
      return {
        roomId: parsed.roomId.trim().toUpperCase(),
        username: parsed.username.trim(),
        sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      };
    }
  } catch (err) {
    console.warn("[App] Failed to read session from sessionStorage:", err);
  }
  return null;
}

export default function App() {
  const inviteRoomId = getRoomIdFromUrl();

  const [roomIdInput, setRoomIdInput] = useState(() => inviteRoomId || getSavedSession()?.roomId || "");
  const [usernameInput, setUsernameInput] = useState(() => getSavedSession()?.username || "");
  const [joinedRoomId, setJoinedRoomId] = useState(() => {
    const session = getSavedSession();
    if (inviteRoomId) {
      return session?.roomId === inviteRoomId ? session.roomId : null;
    }
    return session?.roomId || null;
  });
  const [joinedUsername, setJoinedUsername] = useState(() => {
    const session = getSavedSession();
    if (inviteRoomId) {
      return session?.roomId === inviteRoomId ? session.username : null;
    }
    return session?.username || null;
  });
  const [joinedSessionId, setJoinedSessionId] = useState(() => {
    const session = getSavedSession();
    if (inviteRoomId) {
      return session?.roomId === inviteRoomId ? session.sessionId : null;
    }
    return session?.sessionId || null;
  });
  const [showJoinExisting, setShowJoinExisting] = useState(() => Boolean(inviteRoomId));
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [joinErrorMessage, setJoinErrorMessage] = useState("");
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);

  const isSubmittingRef = useRef(false);
  const isFirstMountRef = useRef(true);

  // Synchronize browser address bar with the active room
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      if (joinedRoomId) {
        syncUrlWithRoom(joinedRoomId);
      }
      return;
    }
    syncUrlWithRoom(joinedRoomId);
  }, [joinedRoomId]);

  const serverDown = useServerStatus();

  // Keep local username and sessionStorage updated if server auto-disambiguates the name
  const handleAssignedUsername = useCallback((assignedName) => {
    if (!assignedName) return;
    setJoinedUsername((prev) => {
      if (prev === assignedName) return prev;
      try {
        const session = getSavedSession();
        if (session) {
          session.username = assignedName;
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
        }
      } catch (err) {
        console.warn("[App] Failed to update disambiguated username in sessionStorage:", err);
      }
      return assignedName;
    });
  }, []);

  const handleRoomError = useCallback((err) => {
    console.warn("[App] room:error received:", err);
    setJoinErrorMessage(err?.message || "Room not found. Please check the code and try again.");
    setShowJoinExisting(true);
    setJoinedRoomId(null);
    setJoinedUsername(null);
    setJoinedSessionId(null);
    syncUrlWithRoom(null);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) {
      console.warn("[App] Failed to clear session:", e);
    }
  }, []);

  const {
    roomState,
    isDisplaced,
    reclaimSession,
    emitPlay,
    emitPause,
    emitSeek,
    emitChangeSource,
    emitBuffering,
  } = useSyncPlayer(
    joinedRoomId,
    joinedUsername,
    joinedSessionId,
    handleAssignedUsername,
    isCreatingRoom,
    handleRoomError
  );

  const { messages, sendMessage } = useChat(joinedRoomId);

  const { localFile, localBlobUrl, selectFile, clearLocalFile } = useLocalMedia();

  const handleSelectFile = useCallback(
    (file) => {
      selectFile(file);
      if (file && (joinedRoomId || getSavedSession()?.roomId)) {
        setSavedPlayingFile(joinedRoomId || getSavedSession()?.roomId, file);
      }
    },
    [joinedRoomId, selectFile]
  );

  // Synchronously flag whether this session expects to auto-reload a previously selected/playing video
  const [isRestoringPlayingFile, setIsRestoringPlayingFile] = useState(() => {
    const saved = getSavedPlayingFile();
    const session = getSavedSession();
    return Boolean(
      session?.roomId &&
      saved?.roomId === session.roomId &&
      saved?.fileName
    );
  });

  // Background file sharing and parallel download state
  const [offeredFile, setOfferedFile] = useState(null);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [isBackgroundDownload, setIsBackgroundDownload] = useState(false);
  const [backgroundDownloadFileName, setBackgroundDownloadFileName] = useState(null);
  const [savedToFilePicker, setSavedToFilePicker] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [uploadCompleteInfo, setUploadCompleteInfo] = useState(null);
  const [completedUploads, setCompletedUploads] = useState([]);
  const [rejectedOfferInfo, setRejectedOfferInfo] = useState(null);
  const [rejectedPeers, setRejectedPeers] = useState([]);

  const roomStateRef = useRef(roomState);
  roomStateRef.current = roomState;
  const activeUploadsRef = useRef({});

  // Unified handler when a peer cancels an active transfer or rejects an offer
  const handlePeerCancelledOrRejected = useCallback(
    ({ socketId, username, fileName, isCancelled = false }) => {
      const peerUsername = username || "A room member";

      setRejectedPeers((prev) => {
        const next = [
          ...prev.filter(
            (p) =>
              (socketId && p.socketId !== socketId) ||
              (!socketId && p.username !== peerUsername)
          ),
          {
            socketId,
            username: peerUsername,
            fileName,
            isCancelled,
          },
        ];

        // Active uploads remaining (excluding this peer who just cancelled)
        const activeUploadEntries = Object.entries(
          activeUploadsRef.current || {}
        ).filter(([id]) => id !== socketId);
        const hasRemainingUploads = activeUploadEntries.length > 0;

        // Current other members in room
        const myId = socket?.id;
        const currentMembers = roomStateRef.current?.members || [];
        const otherMembers = currentMembers.filter(
          (m) => (myId ? m.socketId !== myId : true)
        );

        // Are all other room members accounted for in the rejected/cancelled list?
        // Note: if otherMembers is empty or has <= next.length, all known members are accounted for!
        const allOthersAccounted =
          otherMembers.length === 0 ||
          otherMembers.every((m) =>
            next.some(
              (r) =>
                (r.socketId && r.socketId === m.socketId) ||
                (r.username && m.username && r.username.toLowerCase() === m.username.toLowerCase())
            )
          );

        // If no active uploads remain and all other members have cancelled/rejected:
        // Clear offeredFile so "Offered [file] to room [Cancel]" is NOT shown anymore!
        if (!hasRemainingUploads && allOthersAccounted) {
          setOfferedFile(null);
          setRejectedOfferInfo({
            receiverUsername:
              otherMembers.length > 1 ? "All room members" : peerUsername,
            fileName,
            isCancelled,
          });
        }

        return next;
      });
    },
    []
  );

  // P2P WebRTC File Transfer hook for Host (Sender) and Peer (Receiver)
  const isLocalFileSelectionRef = useRef(false);
  const isBackgroundDownloadRef = useRef(false);
  isBackgroundDownloadRef.current = isBackgroundDownload;
  const {
    downloadState,
    downloadProgress,
    downloadError,
    startDownload,
    cancelDownload,
    cancelUpload,
    resetDownloadState,
    playDownloadedFile,
    exportDownloadedFile,
    restoreCompletedDownload,
    activeUploads,
  } = useP2PTransfer({
    localFile,
    offeredFile,
    onFileReceived: (file) => {
      if (isBackgroundDownloadRef.current) {
        // Background download completed in the background: do not interrupt active playback
        return;
      }
      isLocalFileSelectionRef.current = true;
      handleSelectFile(file);
    },
    onUploadComplete: ({ username, fileName, peerSocketId }) => {
      setUploadCompleteInfo({ username, fileName });
      setCompletedUploads((prev) => [
        ...prev.filter((item) => item.username !== username || item.fileName !== fileName),
        { id: peerSocketId || `${username}-${Date.now()}`, username, fileName },
      ]);
      setOfferedFile(null); // Clear active offer so "Offered ... to room" disappears!
    },
    onUploadCancelled: ({ peerSocketId, username, fileName }) => {
      handlePeerCancelledOrRejected({
        socketId: peerSocketId,
        username,
        fileName,
        isCancelled: true,
      });
    },
    onDownloadComplete: ({ file, fileName }) => {
      if (isBackgroundDownloadRef.current) {
        setShowCompleteModal(true);
      }
    },
  });
  activeUploadsRef.current = activeUploads;

  // Invoked when this user chooses a local video file (via PickFile button or prompt).
  // If a video is already playing and user selects a different file, offers it to room without stopping playback.
  const handleUserSelectLocalFile = useCallback(
    (file) => {
      if (!file) return;
      const isSameAsRoom =
        roomState?.mediaType === "file" &&
        roomState?.mediaMetadata?.fileName &&
        file.name === roomState.mediaMetadata.fileName;

      // Check if a local video room is active
      const isLocalVideoActive =
        roomState?.mediaType === "file" &&
        Boolean(roomState?.mediaMetadata?.fileName);

      // If a local video room is active and user picks a DIFFERENT file:
      if (isLocalVideoActive && !isSameAsRoom) {
        setOfferedFile(file);
        setRejectedOfferInfo(null);
        setRejectedPeers([]);
        setUploadCompleteInfo(null);
        setCompletedUploads([]);
        socket.emit("file:announce", {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || "video/mp4",
        });
        return;
      }

      isLocalFileSelectionRef.current = true;
      cancelDownload();
      cleanupAllOPFSFiles();
      handleSelectFile(file);

      if (!isSameAsRoom) {
        emitChangeSource({
          mediaType: "file",
          mediaMetadata: {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type || "video/mp4",
          },
        });
      }
    },
    [
      roomState?.mediaType,
      roomState?.mediaMetadata?.fileName,
      cancelDownload,
      handleSelectFile,
      emitChangeSource,
    ]
  );

  // Handle incoming background file offer download initiation
  // Handle receiver rejecting/dismissing an incoming file offer
  const handleRejectOffer = useCallback((offer) => {
    if (offer?.senderSocketId) {
      socket.emit("file:reject_offer", {
        senderSocketId: offer.senderSocketId,
        fileName: offer.fileName,
      });
    }
    setIncomingOffer(null);
  }, []);

  const handleStartBackgroundDownload = useCallback(
    async (offer) => {
      if (!offer) return;
      setIncomingOffer(null);
      setShowCompleteModal(false);
      resetDownloadState();
      setIsBackgroundDownload(true);
      setBackgroundDownloadFileName(offer.fileName);

      const supportsSavePicker = typeof window !== "undefined" && "showSaveFilePicker" in window;

      if (supportsSavePicker) {
        const cleanName = sanitizeSuggestedName(offer.fileName);
        const ext = cleanName.includes(".") ? cleanName.split(".").pop().toLowerCase() : "mp4";
        const mimeType = offer.fileType || (ext === "mkv" ? "video/x-matroska" : `video/${ext}`);

        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: cleanName,
            types: [
              {
                description: "Video File",
                accept: { [mimeType]: [`.${ext}`] },
              },
            ],
          });
          setSavedToFilePicker(true);
          startDownload(offer.senderSocketId, offer, fileHandle);
          return;
        } catch (err) {
          if (err.name === "AbortError") {
            setIsBackgroundDownload(false);
            resetDownloadState();
            handleRejectOffer(offer);
            return;
          }
          try {
            const fileHandle = await window.showSaveFilePicker({ suggestedName: cleanName });
            setSavedToFilePicker(true);
            startDownload(offer.senderSocketId, offer, fileHandle);
            return;
          } catch (retryErr) {
            if (retryErr.name === "AbortError") {
              setIsBackgroundDownload(false);
              resetDownloadState();
              handleRejectOffer(offer);
              return;
            }
          }
        }
      }

      // Brave / Safari / Firefox fallback: OPFS disk stream
      setSavedToFilePicker(false);
      cleanupOPFSFile(offer.fileName);
      const opfsHandle = await getOPFSFileHandle(offer.fileName);
      startDownload(offer.senderSocketId, offer, opfsHandle);
    },
    [startDownload, resetDownloadState, handleRejectOffer]
  );

  // Listen for background file offers, cancellations, and rejections
  useEffect(() => {
    const onFileOffered = (data) => {
      if (data?.senderSocketId === socket?.id) return;
      if (roomState?.mediaType === "file") {
        setIncomingOffer(data);
      }
    };

    const onOfferCancelled = (data) => {
      setIncomingOffer((prev) => {
        if (prev && prev.senderSocketId === data?.senderSocketId) {
          return null;
        }
        return prev;
      });
    };

    const onOfferRejected = (data) => {
      handlePeerCancelledOrRejected({
        socketId: data?.receiverSocketId,
        username: data?.receiverUsername,
        fileName: data?.fileName,
        isCancelled: false,
      });
    };

    socket.on("file:offered", onFileOffered);
    socket.on("file:offer_cancelled", onOfferCancelled);
    socket.on("file:offer_rejected", onOfferRejected);
    return () => {
      socket.off("file:offered", onFileOffered);
      socket.off("file:offer_cancelled", onOfferCancelled);
      socket.off("file:offer_rejected", onOfferRejected);
    };
  }, [roomState?.mediaType, handlePeerCancelledOrRejected]);


  // Auto-reload the video directly from OPFS on refresh if it was already selected and playing
  useEffect(() => {
    if (!joinedRoomId || roomState?.mediaType !== "file" || !roomState?.mediaMetadata?.fileName) {
      if (isRestoringPlayingFile) setIsRestoringPlayingFile(false);
      return;
    }

    if (localFile) {
      if (isRestoringPlayingFile) setIsRestoringPlayingFile(false);
      return;
    }

    const saved = getSavedPlayingFile();
    if (
      saved &&
      saved.roomId === joinedRoomId &&
      saved.fileName === roomState.mediaMetadata.fileName
    ) {
      let isSubscribed = true;
      (async () => {
        try {
          const opfsFile = await findOPFSFile(
            roomState.mediaMetadata.fileName,
            roomState.mediaMetadata.fileSize
          );
          if (!isSubscribed) return;

          if (opfsFile) {
            isLocalFileSelectionRef.current = true;
            handleSelectFile(opfsFile);
          }
        } catch (err) {
          console.warn("[App] Failed to auto-restore playing file from OPFS:", err);
        } finally {
          if (isSubscribed) {
            setIsRestoringPlayingFile(false);
          }
        }
      })();

      return () => {
        isSubscribed = false;
      };
    } else {
      if (isRestoringPlayingFile) {
        setIsRestoringPlayingFile(false);
      }
    }
  }, [
    joinedRoomId,
    roomState?.mediaType,
    roomState?.mediaMetadata?.fileName,
    roomState?.mediaMetadata?.fileSize,
    localFile,
    handleSelectFile,
  ]);

  // Sweep stale temporary files from OPFS on startup only if user is NOT returning to an active room session
  useEffect(() => {
    if (!getSavedSession()) {
      clearSavedPlayingFile();
      cleanupAllOPFSFiles();
    }
  }, []);

  useEffect(() => {
    if (!joinedRoomId) {
      clearSavedPlayingFile();
      clearLocalFile();
      cleanupAllOPFSFiles();
      setOfferedFile(null);
      setIncomingOffer(null);
      setIsBackgroundDownload(false);
      setShowCompleteModal(false);
      setUploadCompleteInfo(null);
      setCompletedUploads([]);
      setRejectedOfferInfo(null);
      setRejectedPeers([]);
    }
  }, [joinedRoomId, clearLocalFile]);

  const hostMember = roomState?.members?.find((m) => m.isHost);
  const hostSocketId = hostMember?.socketId;
  const hostUsername = hostMember?.username || "Host";

  // Decoupled file provider: determine who owns the current file (guest or host)
  const fileOwnerSocketId =
    roomState?.mediaOwnerSocketId ||
    roomState?.mediaMetadata?.ownerSocketId ||
    hostSocketId;
  const fileOwnerMember = roomState?.members?.find((m) => m.socketId === fileOwnerSocketId);
  const fileOwnerUsername =
    roomState?.mediaOwnerUsername ||
    roomState?.mediaMetadata?.ownerUsername ||
    fileOwnerMember?.username ||
    hostUsername;

  // Local user is the file provider if matched by socket ID or username
  const isSelfFileOwner =
    (Boolean(fileOwnerSocketId) && fileOwnerSocketId === socket.id) ||
    fileOwnerUsername === joinedUsername;

  const canDownload =
    !isSelfFileOwner && Boolean(fileOwnerSocketId) && roomState?.mediaType === "file";

  const savedPlaying = getSavedPlayingFile();
  const isResume = Boolean(
    roomState?.mediaType === "file" &&
    roomState?.mediaMetadata?.fileName &&
    (isSelfFileOwner ||
      (savedPlaying &&
        savedPlaying.roomId === joinedRoomId &&
        savedPlaying.fileName === roomState.mediaMetadata.fileName))
  );

  const webMediaTitle = useMediaTitle(roomState?.mediaUrl);
  const mediaTitle =
    roomState?.mediaType === "file"
      ? roomState?.mediaMetadata?.fileName || "Local Video"
      : webMediaTitle;

  // Clear local file when the room transitioned from file mode to non-file mode,
  // or when ANY user in the room selects a different local video file than what is currently loaded.
  const prevMediaTypeRef = useRef(roomState?.mediaType);
  const prevFileMetadataRef = useRef(roomState?.mediaMetadata);

  useEffect(() => {
    const currentType = roomState?.mediaType;
    const currentMeta = roomState?.mediaMetadata;
    const prevType = prevMediaTypeRef.current;
    prevMediaTypeRef.current = currentType;
    const prevMeta = prevFileMetadataRef.current;
    prevFileMetadataRef.current = currentMeta;

    // 1. Room transitioned out of file mode to URL / YouTube
    if (prevType === "file" && currentType !== "file") {
      isLocalFileSelectionRef.current = false;
      clearSavedPlayingFile();
      cancelDownload();
      clearLocalFile();
      cleanupAllOPFSFiles();
      return;
    }

    // 2. Room is in file mode: check if this client currently holds a DIFFERENT file than the room
    if (currentType === "file" && currentMeta?.fileName) {
      if (isLocalFileSelectionRef.current) {
        // This client initiated the file change locally
        isLocalFileSelectionRef.current = false;
        return;
      }

      // Only clear if this client currently has a loaded file that does NOT match the room's current file
      const isFileMismatch =
        localFile &&
        (localFile.name !== currentMeta.fileName ||
          (currentMeta.fileSize &&
            Math.abs(localFile.size - currentMeta.fileSize) > 1024 * 1024));

      if (isFileMismatch) {
        clearSavedPlayingFile();
        cancelDownload();
        clearLocalFile();
        cleanupAllOPFSFiles();
      }
    }
  }, [
    roomState?.mediaType,
    roomState?.mediaMetadata?.fileName,
    roomState?.mediaMetadata?.fileSize,
    localFile,
    clearLocalFile,
    cancelDownload,
  ]);

  // Exit theater mode on Escape key press
  useEffect(() => {
    if (!isTheaterMode) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsTheaterMode(false);
        setIsChatCollapsed(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTheaterMode]);

  const isDesktop = useMediaQuery("(min-width: 1024px)"); // matches Tailwind's `lg`
  const chatInSidebar = !isTheaterMode && isDesktop;

  const toggleTheaterMode = () => {
    setIsTheaterMode((prev) => {
      if (prev) {
        setIsChatCollapsed(false);
      }
      return !prev;
    });
  };

  // The current media URL shown back in the input bar when it's a YouTube link
  const currentYoutubeUrl = /youtube\.com|youtu\.be/.test(roomState?.mediaUrl || "")
    ? roomState.mediaUrl
    : null;

  const performJoin = (targetRoomId, targetUsername, isCreating = false) => {
    const cleanRoomId = (targetRoomId || "").trim().toUpperCase();
    const cleanUsername = (targetUsername || "").trim();
    if (!cleanRoomId || !cleanUsername) return;
    if (isSubmittingRef.current) return;

    isSubmittingRef.current = true;

    // Reuse existing sessionId if re-joining same room, otherwise generate fresh UUID
    const currentSession = getSavedSession();
    const sessionId = (currentSession?.roomId === cleanRoomId && currentSession?.sessionId)
      ? currentSession.sessionId
      : (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

    const doEmit = () => {
      socket.emit(
        "room:join",
        {
          roomId: cleanRoomId,
          username: cleanUsername,
          sessionId,
          isCreating,
        },
        (response) => {
          isSubmittingRef.current = false;
          if (response && !response.success) {
            if (response.code === "ROOM_ALREADY_EXISTS" && isCreating) {
              // Rare collision: automatically re-roll a new code and retry
              const retryRoomId = generateRoomId();
              setRoomIdInput(retryRoomId);
              performJoin(retryRoomId, cleanUsername, true);
              return;
            }
            setJoinErrorMessage(response.error || "Room not found. Please check the room code and try again.");
            return;
          }

          // Confirmed by server: clear any error, save session, and transition to player screen
          const effectiveUsername = response?.username || cleanUsername;
          const effectiveSessionId = response?.sessionId || sessionId;

          setJoinErrorMessage("");
          try {
            sessionStorage.setItem(
              SESSION_STORAGE_KEY,
              JSON.stringify({ roomId: cleanRoomId, username: effectiveUsername, sessionId: effectiveSessionId })
            );
          } catch (err) {
            console.warn("[App] Failed to save session to sessionStorage:", err);
          }

          setIsCreatingRoom(isCreating);
          setJoinedRoomId(cleanRoomId);
          setJoinedUsername(effectiveUsername);
          setJoinedSessionId(effectiveSessionId);
        }
      );
    };

    if (socket.connected) {
      doEmit();
    } else {
      socket.connect();
      socket.once("connect", doEmit);
    }
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    const cleanUsername = usernameInput.trim();
    if (!cleanUsername) return;

    const newRoomId = generateRoomId();
    setRoomIdInput(newRoomId);
    performJoin(newRoomId, cleanUsername, true);
  };

  const handleJoinExisting = (e) => {
    e.preventDefault();
    const cleanRoomId = roomIdInput.trim().toLowerCase();
    const cleanUsername = usernameInput.trim();
    if (!cleanUsername) return;

    const rawChars = cleanRoomId.replace(/[^a-z0-9]/g, "");
    if (rawChars.length < 8) {
      setJoinErrorMessage("Please enter the complete 8-character room code.");
      return;
    }

    performJoin(cleanRoomId, cleanUsername, false);
  };

  const handleLeaveRoom = () => {
    socket.emit("room:leave");
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (err) {
      console.warn("[App] Failed to clear session:", err);
    }
    clearSavedPlayingFile();
    cancelDownload();
    clearLocalFile();
    cleanupAllOPFSFiles();
    setJoinedRoomId(null);
    setJoinedUsername(null);
    setJoinedSessionId(null);
    syncUrlWithRoom(null);
  };

  const handleSelectVideo = (mediaUrl) => {
    isLocalFileSelectionRef.current = false;
    clearSavedPlayingFile();
    cancelDownload();
    clearLocalFile();
    cleanupAllOPFSFiles();
    emitChangeSource(mediaUrl);
  };

  const handleLocalFileSelected = (file) => {
    handleUserSelectLocalFile(file);
  };

  if (!joinedRoomId) {
    return (
      <>
        <ServerStatus serverDown={serverDown} />
        <div className="min-h-screen bg-surface text-ink flex flex-col items-center justify-center p-4 font-sans">
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold tracking-tight text-brand">
                Vync
              </h1>
              <p className="text-ink-muted text-sm mt-2">
                Watch anything together, from links to files
              </p>
            </div>

            <form
              onSubmit={showJoinExisting ? handleJoinExisting : handleCreateRoom}
              className="bg-surface-raise p-6 shadow-2xl space-y-4"
            >
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">
                  Username
                </label>
                <input
                  type="text"
                  required
                  placeholder="Sam"
                  value={usernameInput}
                  onChange={(e) => {
                    setUsernameInput(e.target.value);
                    if (joinErrorMessage) setJoinErrorMessage("");
                  }}
                  className="w-full bg-ink/5 border border-ink/10 px-4 py-3 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-accent transition-shadow"
                />
              </div>

              {showJoinExisting && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">
                    Room code
                  </label>
                  <RoomCodeInput
                    value={roomIdInput}
                    onChange={(val) => {
                      setRoomIdInput(val);
                      if (joinErrorMessage) setJoinErrorMessage("");
                    }}
                    hasError={Boolean(joinErrorMessage)}
                  />
                  {joinErrorMessage && (
                    <p className="text-red-500 text-xs font-medium pt-0.5">
                      {joinErrorMessage}
                    </p>
                  )}
                </div>
              )}

              {!showJoinExisting && joinErrorMessage && (
                <p className="text-red-500 text-xs font-medium">
                  {joinErrorMessage}
                </p>
              )}

              <button
                type="submit"
                className="w-full bg-accent hover:bg-accent-deep text-on-accent font-bold py-3 transition-colors cursor-pointer"
              >
                {showJoinExisting ? "Join Room" : "Create Room"}
              </button>

              <div className="text-center pt-2">
                {showJoinExisting ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowJoinExisting(false);
                      setJoinErrorMessage("");
                      setRoomIdInput("");
                      syncUrlWithRoom(null);
                    }}
                    className="text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer underline underline-offset-4"
                  >
                    Want to start a new room? Create room
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowJoinExisting(true);
                      setJoinErrorMessage("");
                    }}
                    className="text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer underline underline-offset-4"
                  >
                    Already have a room code?
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </>
    );
  }

  // Modular transfer panel props for sidebar (normal & theater mode) and fullscreen overlay
  const sidebarTransferProps = {
    incomingOffer,
    onDownloadOffer: handleStartBackgroundDownload,
    onRejectOffer: handleRejectOffer,
    isDownloading: isBackgroundDownload,
    downloadFileName: backgroundDownloadFileName,
    downloadState,
    downloadProgress,
    onCancelDownload: () => {
      cancelDownload();
      setIsBackgroundDownload(false);
      setShowCompleteModal(false);
      resetDownloadState();
    },
    activeUploads,
    onCancelUpload: cancelUpload,
    mediaMetadata:
      roomState?.mediaMetadata ||
      (localFile ? { fileSize: localFile.size, fileName: localFile.name } : null),
    offeredFile,
    onCancelOffer: () => {
      setOfferedFile(null);
      setRejectedPeers([]);
      setRejectedOfferInfo(null);
      socket.emit("file:cancel_offer");
    },
    showComplete: showCompleteModal,
    savedToFilePicker,
    onExportFile: exportDownloadedFile,
    onDismissComplete: () => {
      setShowCompleteModal(false);
      setIsBackgroundDownload(false);
      setSavedToFilePicker(false);
      resetDownloadState();
    },
    uploadCompleteInfo,
    uploadCompleteList: completedUploads,
    onDismissUploadComplete: () => {
      setUploadCompleteInfo(null);
      setCompletedUploads([]);
      setRejectedOfferInfo(null);
      setRejectedPeers([]);
    },
    rejectedOfferInfo,
    rejectedPeers,
    onDismissRejectedOffer: () => {
      setRejectedOfferInfo(null);
      setRejectedPeers([]);
    },
  };

  return (
    <>
      <ServerStatus serverDown={serverDown} />
      <main
        className={
          isTheaterMode
            ? "relative h-screen max-h-screen w-screen overflow-hidden bg-black text-ink flex flex-col font-sans p-2 sm:p-3"
            : `min-h-screen bg-surface text-ink flex flex-col font-sans ${chatInSidebar ? "lg:h-screen lg:max-h-screen lg:overflow-hidden" : ""
            }`
        }
      >
        {/* Top-left subtle Vync branding in theater mode */}
        {isTheaterMode && (
          <div className="absolute top-4 left-5 sm:left-6 z-30 flex items-center select-none pointer-events-none">
            <span className="text-xl font-bold tracking-tight text-white select-none">
              Vync
            </span>
          </div>
        )}

        {/* Top-right controls when chat is collapsed in theater mode */}
        {isTheaterMode && isChatCollapsed && (
          <div className="absolute top-4 right-4 sm:right-6 z-30 flex flex-col items-end gap-2.5">
            <button
              type="button"
              onClick={toggleTheaterMode}
              aria-label="Exit theater mode"
              title="Exit theater mode (Esc)"
              className="w-8 h-8 rounded-md bg-surface-raise/90 hover:bg-surface-raise border border-ink/15 text-white flex items-center justify-center shadow-lg backdrop-blur-sm transition-all cursor-pointer hover:border-ink/30 hover:scale-105 active:scale-95"
            >
              <Minimize2 className="w-4 h-4 text-white" />
            </button>
            <button
              type="button"
              onClick={() => setIsChatCollapsed(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-raise/90 hover:bg-surface-raise border border-ink/15 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition-all cursor-pointer hover:border-ink/30 hover:scale-105 active:scale-95 whitespace-nowrap"
              title="Return to original theater mode with chat"
            >
              <span className="w-1 h-1 rounded-2px bg-green-500 animate-pulse shrink-0" />
              <span>Live Chat</span>
            </button>
          </div>
        )}

        <div
          className={
            isTheaterMode
              ? "flex-1 flex min-h-0 flex-row gap-2 sm:gap-3 w-full h-full items-center"
              : "flex-1 flex min-h-0 flex-col lg:flex-row lg:gap-4 xl:gap-6"
          }
        >
          {/* Player column: sized to fit perfectly within the viewport height without scrolling */}
          <div
            style={
              isTheaterMode
                ? undefined
                : chatInSidebar
                  ? { maxWidth: "calc((100dvh - 9rem) * 16 / 9)" }
                  : undefined
            }
            className={
              isTheaterMode
                ? "flex-1 min-w-0 h-full flex items-center justify-center bg-black overflow-hidden"
                : "flex-1 min-w-0 w-full py-3 lg:py-4 space-y-3 flex flex-col pl-4 sm:pl-6 lg:pl-8 pr-4 sm:pr-6 lg:pr-0"
            }
          >
            {/* Top Bar: Vync Logo (top left) + Shrunk LinkInput (hidden in theater mode) */}
            {!isTheaterMode && (
              <div className="flex items-center gap-3 w-full">
                <VyncLogo />
                <div className="flex-1 min-w-0">
                  <LinkInput
                    key={currentYoutubeUrl || ""}
                    onSelect={handleSelectVideo}
                    currentUrl={currentYoutubeUrl}
                    action={
                      <PickFileButton
                        onFileSelected={handleLocalFileSelected}
                        hasLoadedFile={roomState?.mediaType === "file" && Boolean(localBlobUrl)}
                      />
                    }
                  />
                </div>
              </div>
            )}

            {/* Video player wrapper: expands to maximum possible 16:9 bounds without covering buttons */}
            <div
              className={isTheaterMode ? "w-full flex items-center justify-center" : "w-full"}
              style={
                isTheaterMode
                  ? isChatCollapsed
                    ? {
                      maxWidth:
                        "min(max(280px, calc(100% - 14rem)), calc((100dvh - 2rem) * 16 / 9), calc((100vh - 2rem) * 16 / 9))",
                    }
                    : {
                      maxWidth:
                        "min(100%, calc((100dvh - 1.5rem) * 16 / 9), calc((100vh - 1.5rem) * 16 / 9))",
                    }
                  : undefined
              }
            >
              <UnifiedPlayer
                roomState={roomState}
                localBlobUrl={localBlobUrl}
                onSelectLocalFile={handleUserSelectLocalFile}
                emitPlay={emitPlay}
                emitPause={emitPause}
                emitSeek={emitSeek}
                emitBuffering={emitBuffering}
                isDisplaced={isDisplaced}
                isRestoringLocalFile={isRestoringPlayingFile}
                isResume={isResume}
                p2pTransfer={{
                  downloadState,
                  downloadProgress,
                  downloadError,
                  onDownloadFromHost: (fileHandle) =>
                    startDownload(fileOwnerSocketId, roomState?.mediaMetadata, fileHandle),
                  onCancelDownload: cancelDownload,
                  onPlayDownloadedFile: playDownloadedFile,
                  onExportDownloadedFile: exportDownloadedFile,
                  onRestoreCompletedDownload: restoreCompletedDownload,
                  hostUsername: fileOwnerUsername,
                  canDownload,
                }}
                fullscreenTransfer={sidebarTransferProps}
              />
            </div>

            {/* Video title, just below the player (hidden in theater mode) */}
            {!isTheaterMode && mediaTitle && (
              <h2
                className="text-ink text-base sm:text-lg lg:text-xl font-bold tracking-tight truncate select-none leading-snug"
                title={mediaTitle}
              >
                {mediaTitle}
              </h2>
            )}

            {/* Chat below the player (mobile fallback, hidden in theater mode or on desktop) */}
            {!isTheaterMode && (
              <div className="lg:hidden space-y-2.5">
                <RoomInfoBox
                  username={joinedUsername}
                  roomId={joinedRoomId}
                  members={roomState?.members}
                  onLeave={handleLeaveRoom}
                  activeUploads={activeUploads}
                  onCancelUpload={cancelUpload}
                  mediaMetadata={roomState?.mediaMetadata || (localFile ? { fileSize: localFile.size, fileName: localFile.name } : null)}
                  transferPanel={<SidebarTransferPanel {...sidebarTransferProps} />}
                />
                <div className="h-96">
                  <ChatPanel
                    messages={messages}
                    onSend={sendMessage}
                    isTheaterMode={isTheaterMode}
                    onToggleTheater={toggleTheaterMode}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Chat sidebar on right side: visible in theater mode or on desktop */}
          <aside
            className={
              isTheaterMode
                ? `${isChatCollapsed
                  ? "hidden"
                  : "flex flex-col w-[40%] sm:w-[320px] md:w-[340px] lg:w-[360px] xl:w-[380px] max-w-[45vw] shrink-0 h-full min-h-0 gap-2.5"
                }`
                : "hidden lg:flex flex-col gap-2.5 flex-1 min-w-[280px] max-w-[420px] 2xl:max-w-[460px] py-3 lg:py-4 pr-4 sm:pr-6 lg:pr-8 min-h-0 h-full"
            }
          >
            {/* Normal mode: RoomInfoBox renders with embedded transferPanel below username box */}
            {!isTheaterMode && (
              <RoomInfoBox
                username={joinedUsername}
                roomId={joinedRoomId}
                members={roomState?.members}
                onLeave={handleLeaveRoom}
                activeUploads={activeUploads}
                onCancelUpload={cancelUpload}
                mediaMetadata={roomState?.mediaMetadata || (localFile ? { fileSize: localFile.size, fileName: localFile.name } : null)}
                transferPanel={<SidebarTransferPanel {...sidebarTransferProps} />}
              />
            )}

            {/* Theater mode: SidebarTransferPanel renders directly above ChatPanel */}
            {isTheaterMode && !isChatCollapsed && (
              <SidebarTransferPanel {...sidebarTransferProps} standalone={true} />
            )}

            <div className="flex-1 min-h-0 w-full">
              <ChatPanel
                messages={messages}
                onSend={sendMessage}
                isTheaterMode={isTheaterMode}
                onToggleTheater={toggleTheaterMode}
                onCollapseChat={() => setIsChatCollapsed(true)}
              />
            </div>
          </aside>
        </div>
      </main>

      {/* Displaced session overlay when user is watching in another tab */}
      {isDisplaced && (
        <DisplacedSessionModal
          onUseHere={reclaimSession}
          onLeave={handleLeaveRoom}
        />
      )}
    </>
  );
}