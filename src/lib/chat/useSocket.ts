'use client';
// src/lib/chat/useSocket.ts
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export function useSocket() {
  const ref = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Cookie auth — nothing is passed in the handshake payload.
    const socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    ref.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setConnected(false);
      console.error('[socket]', err.message);
    });

    // Presence heartbeat. TTL is 45s server-side, so 30s leaves headroom
    // for one dropped beat before the user appears offline.
    const heartbeat = setInterval(() => socket.emit('presence:heartbeat'), 30_000);

    return () => {
      clearInterval(heartbeat);
      socket.disconnect();
      ref.current = null;
    };
  }, []);

  return { socket: ref, connected };
}

export function newClientMsgId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
