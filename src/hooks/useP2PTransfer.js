import { useState, useRef, useEffect, useCallback } from "react";
import { socket } from "../services/socket.js";
import { P2PFileSender, P2PFileReceiver } from "../features/p2p-transfer/index.js";

/**
 * Hook to manage P2P WebRTC file transfers for both Host (Sender) and Peer (Receiver).
 */
export function useP2PTransfer({ localFile, onFileReceived }) {
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
  const iceServersRef = useRef(null);

  useEffect(() => {
    localFileRef.current = localFile;
  }, [localFile]);

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
      const currentFile = localFileRef.current;
      if (!currentFile) {
        socket.emit("p2p:cancel", { to: from, reason: "Host has no local file loaded" });
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
        setActiveUploads((prev) => {
          const next = { ...prev };
          delete next[from];
          return next;
        });
      }
    };

    // 4. Peer or Host left the room - immediately abort associated transfers
    const onUserLeft = ({ socketId }) => {
      if (receiverRef.current && receiverRef.current.hostSocketId === socketId) {
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
        setActiveUploads((prev) => {
          const next = { ...prev };
          delete next[socketId];
          return next;
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
          },
          onError: (err) => {
            setDownloadState("error");
            setDownloadError(err?.message || "Failed to download file from host");
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

  // Receiver method: Cancel download
  const cancelDownload = useCallback(() => {
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

  // Sender method: Cancel upload to a specific peer
  const cancelUpload = useCallback((targetSocketId) => {
    if (sendersRef.current.has(targetSocketId)) {
      const sender = sendersRef.current.get(targetSocketId);
      sendersRef.current.delete(targetSocketId);
      sender.cancel("Upload cancelled by host", true);
      setActiveUploads((prev) => {
        const next = { ...prev };
        delete next[targetSocketId];
        return next;
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

  return {
    downloadState,
    downloadProgress,
    downloadError,
    startDownload,
    cancelDownload,
    cancelUpload,
    playDownloadedFile,
    completedFile,
    activeUploads,
  };
}
