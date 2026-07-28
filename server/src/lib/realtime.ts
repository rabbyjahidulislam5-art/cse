import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import prisma from './prisma';
import { registerEmitters } from './disputes/realtimeBus';

const JWT_SECRET = process.env.JWT_SECRET || 'smart-campus-jwt-secret-change-me';

let io: SocketIOServer | null = null;

// Same Bearer-token-only, no-cookies model as the REST API (see index.ts's CORS comment) — an
// open origin here is consistent with that, not a new relaxation.
export function attachRealtime(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) || (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (!user) return next(new Error('User not found'));
      (socket.data as { userId: string; role: string | null }).userId = user.id;
      (socket.data as { userId: string; role: string | null }).role = user.role;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data as { userId: string; role: string | null };
    socket.join(`user:${userId}`);
    if (role) socket.join(`role:${role}`);

    socket.on('dispute:join', (disputeId: string) => {
      if (typeof disputeId === 'string' && disputeId.length < 100) socket.join(`dispute:${disputeId}`);
    });
    socket.on('dispute:leave', (disputeId: string) => {
      if (typeof disputeId === 'string') socket.leave(`dispute:${disputeId}`);
    });
  });

  // Wires notify() (per-user pushes) and recordTimeline() (per-case-room pushes) to a live push —
  // see lib/disputes/realtimeBus.ts. Every existing call site across every role's route file gets
  // realtime delivery automatically, with zero changes to those routes.
  registerEmitters({
    toUser: (userId, event, payload) => { io?.to(`user:${userId}`).emit(event, payload); },
    toDispute: (disputeId, event, payload) => { io?.to(`dispute:${disputeId}`).emit(event, payload); },
    toRole: (role, event, payload) => { io?.to(`role:${role}`).emit(event, payload); },
  });

  return io;
}
