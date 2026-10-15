import { useState, useRef, useEffect, useCallback } from "react";
import { socket } from "../services/socket.js";
import { P2PFileSender, P2PFileReceiver } from "../features/p2p-transfer/index.js";
import { cleanupOPFSFile, cleanupAllOPFSFiles } from "../features/p2p-transfer/utils/opfsStorage.js";

/**
 * Hook to manage P2P WebRTC file transfers for both Host (Sender) and Peer (Receiver).
 */
export function useP2PTransfer({
  localFile,
  offeredFile = null,
  onFileReceived,
  onUploadComplete = null,
  onUploadCancelled = null,
  onDownloadComplete = null,
}) {
  // Receiver state
  const [downloadState, setDownloadState] = useState("idle"); // 'idle' | 'requesting' | 'transferring' | 'completed' | 'error'
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [completedFile, setCompletedFile] = useState(null);

  // Sender state: Map of active outgoing transfers by peer socketId
  const [activeUploads, setActiveUploads] = useState({});

  const receiverRef = useRef(null);
  const sendersRef = useRef(new Map()); // Map<targetSocketId, P2PFileSender>
  const localFileRef = useRef(localFile);
  const offeredFileRef = useRef(offeredFile);
  const onUploadCancelledRef = useRef(onUploadCancelled);
  const iceServersRef = useRef(null);
  const activeDownloadFileNameRef = useRef(null);

  useEffect(() => {
    onUploadCancelledRef.current = onUploadCancelled;
  }, [onUploadCancelled]);

  useEffect(() => {
    localFileRef.current = localFile;
  }, [localFile]);

  useEffect(() => {
    offeredFileRef.current = offeredFile;
  }, [offeredFile]);

  // Query backend for ICE/TURN configurations on mount
  useEffect(() => {
    if (socket?.connected) {
      socket.emit("p2p:get-ice-servers", (config) => {
        if (config?.iceServers) {
          iceServersRef.current = config.iceServers;
        }
      });
    }
  }, []);

  // Handle incoming signaling messages from Socket.IO
  useEffect(() => {
    // 1. Peer requests file from Host
    const onP2PRequest = async ({ from, fromUsername, fileName, fileSize }) => {
      // Find the file to serve: prioritize offeredFile if filename matches, or fallback to localFile
      let currentFile = null;
      if (offeredFileRef.current && (!fileName || offeredFileRef.current.name === fileName)) {
        currentFile = offeredFileRef.current;
      } else if (localFileRef.current && (!fileName || localFileRef.current.name === fileName)) {
        currentFile = localFileRef.current;
      } else {
        currentFile = offeredFileRef.current || localFileRef.current;
      }

      if (!currentFile) {
        socket.emit("p2p:cancel", { to: from, reason: "Peer has no local file loaded" });
        return;
      }

      // Close any previous sender for this specific peer
      if (sendersRef.current.has(from)) {
        sendersRef.current.get(from).cancel("Starting new session");
        sendersRef.current.delete(from);
      }

      const totalBytes = currentFile.size || fileSize || 0;

      // Immediately register active upload on host UI
      setActiveUploads((prev) => ({
        ...prev,
        [from]: {
          username: fromUsername,
          fileName: currentFile.name,
          percent: 0,
          speed: 0,
          sentBytes: 0,
          totalBytes,
          eta: null,
          startedAt: Date.now(),
        },
      }));

      const sender = new P2PFileSender(socket, from, currentFile, {
        iceServers: iceServersRef.current,
        onProgress: (prog) => {
          setActiveUploads((prev) => ({
            ...prev,
            [from]: {
              username: fromUsername,
              fileName: currentFile.name,
              percent: prog.percent,
              speed: prog.speed,
              sentBytes:
                prog.sentBytes != null && prog.sentBytes > 0
                  ? prog.sentBytes
                  : totalBytes > 0 && prog.percent > 0
                    ? Math.round(((prog.percent || 0) / 100) * totalBytes)
                    : 0,
              totalBytes: prog.totalBytes || totalBytes,
              eta: prog.eta,
              startedAt: prev[from]?.startedAt || Date.now(),
            },
          }));
        },
        onComplete: () => {
          setActiveUploads((prev) => {
            const next = { ...prev };
            delete next[from];
            return next;
          });
          sendersRef.current.delete(from);
          onUploadComplete?.({
            peerSocketId: from,
            username: fromUsername,
            fileName: currentFile?.name,
          });
        },
        onError: (err) => {
          console.warn(`[useP2PTransfer] Upload to ${from} failed:`, err);
          setActiveUploads((prev) => {
            const next = { ...prev };
            delete next[from];
            return next;
          });
          sendersRef.current.delete(from);
        },
      });

      sendersRef.current.set(from, sender);
      await sender.start();
    };

    // 2. Incoming WebRTC signal (SDP Offer/Answer or ICE Candidate)
    const onP2PSignal = ({ from, signal }) => {
      // Check if this signal is for our active receiver
      if (receiverRef.current) {
        receiverRef.current.handleSignal(signal);
      }

      // Or if it's for one of our active senders
      if (sendersRef.current.has(from)) {
        sendersRef.current.get(from).handleSignal(signal);
      }
    };

    // 3. Remote peer cancelled transfer
    const onP2PCancel = ({ from, reason }) => {
      // Host cancelled active download
      if (receiverRef.current && receiverRef.current.hostSocketId === from) {
        if (activeDownloadFileNameRef.current) {
          cleanupOPFSFile(activeDownloadFileNameRef.current);
        }
        const receiver = receiverRef.current;
        receiverRef.current = null;
        setDownloadState("error");
        setDownloadError(reason || "Transfer cancelled by host");
        receiver.cancel(reason || "Transfer cancelled by host", false); // Do not echo cancel back to host
      }

      // Peer cancelled active upload
      if (sendersRef.current.has(from)) {
        const sender = sendersRef.current.get(from);
        sendersRef.current.delete(from);
        sender.cancel(reason || "Transfer cancelled by peer", false); // Do not echo cancel back to peer
        let cancelledPeer = null;
        setActiveUploads((prev) => {
          cancelledPeer = prev[from];
          const next = { ...prev };
          delete next[from];
          return next;
        });
        onUploadCancelledRef.current?.({
          peerSocketId: from,
          username: cancelledPeer?.username,
          fileName: cancelledPeer?.fileName,
          reason: reason || "Transfer cancelled by peer",
        });
      }
    };

    // 4. Peer or Host left the room - immediately abort associated transfers
    const onUserLeft = ({ socketId }) => {
      if (receiverRef.current && receiverRef.current.hostSocketId === socketId) {
        if (activeDownloadFileNameRef.current) {
          cleanupOPFSFile(activeDownloadFileNameRef.current);
        }
        const receiver = receiverRef.current;
        receiverRef.current = null;
        setDownloadState("error");
        setDownloadError("Host left the room");
        receiver.cancel("Host left the room", false);
      }

      if (sendersRef.current.has(socketId)) {
        const sender = sendersRef.current.get(socketId);
        sendersRef.current.delete(socketId);
        sender.cancel("Peer left the room", false);
        let cancelledPeer = null;
        setActiveUploads((prev) => {
          cancelledPeer = prev[socketId];
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
        onUploadCancelledRef.current?.({
          peerSocketId: socketId,
          username: cancelledPeer?.username,
          fileName: cancelledPeer?.fileName,
          reason: "Peer left the room",
        });
      }
    };

    socket.on("p2p:request", onP2PRequest);
    socket.on("p2p:signal", onP2PSignal);
    socket.on("p2p:cancel", onP2PCancel);
    socket.on("room:user_left", onUserLeft);

    return () => {
      socket.off("p2p:request", onP2PRequest);
      socket.off("p2p:signal", onP2PSignal);
      socket.off("p2p:cancel", onP2PCancel);
      socket.off("room:user_left", onUserLeft);
    };
  }, []);

  // Receiver method: Request file from Host
  const startDownload = useCallback(
    (hostSocketId, fileMetadata, fileHandle = null) => {
      if (!hostSocketId || !fileMetadata) return;

      if (receiverRef.current) {
        receiverRef.current.cancel("Restarting download", true);
      }

      setDownloadState("requesting");
      setDownloadProgress({ percent: 0, receivedBytes: 0, totalBytes: fileMetadata.fileSize, speed: 0 });
      setDownloadError(null);
      setCompletedFile(null);

      activeDownloadFileNameRef.current = fileMetadata?.fileName || null;

      const receiver = new P2PFileReceiver(
        socket,
        hostSocketId,
        {
          iceServers: iceServersRef.current,
          onProgress: (prog) => {
            setDownloadState("transferring");
            setDownloadProgress(prog);
          },
          onComplete: (file, blob, meta) => {
            setDownloadState("completed");
            setDownloadProgress({ percent: 100, isFinalizing: false });
            setCompletedFile(file);
            receiverRef.current = null;
            onDownloadComplete?.({
              file,
              fileName: file?.name || meta?.fileName,
              meta,
            });
          },
          onError: (err) => {
            if (fileMetadata?.fileName) {
              cleanupOPFSFile(fileMetadata.fileName);
            }
            setDownloadState("error");
            setDownloadError(err?.message || "Failed to download file from peer");
            receiverRef.current = null;
          },
        },
        fileHandle
      );

      receiverRef.current = receiver;
      receiver.start(fileMetadata);
    },
    []
  );

  // Receiver method: Mount and play the downloaded file when user clicks "Play"
  const playDownloadedFile = useCallback(() => {
    if (completedFile && onFileReceived) {
      onFileReceived(completedFile);
      setCompletedFile(null);
      setDownloadState("idle");
    }
  }, [completedFile, onFileReceived]);

  // Receiver method: Trigger browser download to save completed file to OS disk
  const exportDownloadedFile = useCallback(() => {
    if (!completedFile) return;
    try {
      const url = URL.createObjectURL(completedFile);
      const a = document.createElement("a");
      a.href = url;
      a.download = completedFile.name || "video.mp4";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (err) {
      console.warn("[useP2PTransfer] Failed to export downloaded file:", err);
    }
  }, [completedFile]);

  // Receiver method: Cancel download
  const cancelDownload = useCallback(() => {
    if (activeDownloadFileNameRef.current) {
      cleanupOPFSFile(activeDownloadFileNameRef.current);
    }
    if (receiverRef.current) {
      const receiver = receiverRef.current;
      receiverRef.current = null;
      receiver.cancel("Download cancelled by user", true);
    }
    setDownloadState("idle");
    setDownloadProgress(null);
    setDownloadError(null);
    setCompletedFile(null);
  }, []);

  // Receiver method: Cleanly reset download state (e.g. when dismissing completion card or starting new session)
  const resetDownloadState = useCallback(() => {
    if (receiverRef.current) {
      const receiver = receiverRef.current;
      receiverRef.current = null;
      receiver.cancel("Reset download state", false);
    }
    setDownloadState("idle");
    setDownloadProgress(null);
    setDownloadError(null);
    setCompletedFile(null);
    activeDownloadFileNameRef.current = null;
  }, []);

  // Sender method: Cancel upload to a specific peer
  const cancelUpload = useCallback((targetSocketId) => {
    if (sendersRef.current.has(targetSocketId)) {
      const sender = sendersRef.current.get(targetSocketId);
      sendersRef.current.delete(targetSocketId);
      sender.cancel("Upload cancelled by host", true);
      let cancelledPeer = null;
      setActiveUploads((prev) => {
        cancelledPeer = prev[targetSocketId];
        const next = { ...prev };
        delete next[targetSocketId];
        return next;
      });
      onUploadCancelledRef.current?.({
        peerSocketId: targetSocketId,
        username: cancelledPeer?.username,
        fileName: cancelledPeer?.fileName,
        reason: "Upload cancelled by host",
      });
    }
  }, []);

  // Clean up all active connections on unmount
  useEffect(() => {
    return () => {
      if (receiverRef.current) {
        receiverRef.current.cancel("Component unmounted", true);
        receiverRef.current = null;
      }
      for (const sender of sendersRef.current.values()) {
        sender.cancel("Component unmounted", true);
      }
      sendersRef.current.clear();
      setCompletedFile(null);
    };
  }, []);

  // Receiver method: Restore a previously completed download from OPFS cache (e.g. after page refresh)
  const restoreCompletedDownload = useCallback((file) => {
    if (!file) return;
    setDownloadState("completed");
    setDownloadProgress({
      percent: 100,
      isFinalizing: false,
      totalBytes: file.size,
      receivedBytes: file.size,
    });
    setDownloadError(null);
    setCompletedFile(file);
    activeDownloadFileNameRef.current = file.name;
  }, []);

  return {
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
    completedFile,
    activeUploads,
  };
}
