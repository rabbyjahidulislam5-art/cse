import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');

let socket: Socket | null = null;

// Single shared connection for the whole app — every layout/page that needs realtime just calls
// this again and gets the same live socket, reference-counted by React's effect cleanup.
export function getSocket(): Socket | null {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  if (socket?.connected || socket?.active) return socket;
  socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'] });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribes to a dispute notification event for the lifetime of the calling component. */
export function useDisputeSocket(onNotification: (payload: { id: string; disputeId: string | null; type: string; title: string; body: string; createdAt: string }) => void) {
  const handlerRef = useRef(onNotification);
  handlerRef.current = onNotification;

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const handler = (payload: any) => handlerRef.current(payload);
    s.on('dispute:notification', handler);
    return () => { s.off('dispute:notification', handler); };
  }, []);
}

/** Joins a specific case's room so live message/status updates arrive while the detail page is open. */
export function useDisputeRoom(disputeId: string | undefined, onUpdate: (payload: { id: string; eventType: string; summary: string; createdAt: string }) => void) {
  const handlerRef = useRef(onUpdate);
  handlerRef.current = onUpdate;

  useEffect(() => {
    if (!disputeId) return;
    const s = getSocket();
    if (!s) return;
    const handler = (payload: any) => handlerRef.current(payload);
    const join = () => s.emit('dispute:join', disputeId);
    if (s.connected) join(); else s.once('connect', join);
    s.on('dispute:timeline', handler);
    return () => {
      s.off('dispute:timeline', handler);
      s.emit('dispute:leave', disputeId);
    };
  }, [disputeId]);
}
