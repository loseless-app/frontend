import { useState, useEffect } from "react";
import { socket } from "../services/socket.js";

// Returns true while the backend server is unreachable
export function useServerStatus() {
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    const onConnect = () => setServerDown(false);
    const onConnectError = () => setServerDown(true);
    const onDisconnect = (reason) => {
      // "io server disconnect" means the server closed the connection
      // intentionally, so it was reachable. Any other reason means the
      // transport dropped, i.e. the server is unreachable.
      if (reason !== "io server disconnect") {
        setServerDown(true);
      }
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return serverDown;
}