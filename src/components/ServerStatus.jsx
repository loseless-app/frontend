import React from "react";

// Small indicator shown when the backend server is unreachable
export function ServerStatus({ serverDown }) {
  if (!serverDown) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50">
      <span className="bg-red-500/90 px-2.5 py-1 text-xs font-medium text-white shadow">
        Server down
      </span>
    </div>
  );
}