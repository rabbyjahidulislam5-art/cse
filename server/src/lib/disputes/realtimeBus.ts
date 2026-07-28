// A tiny neutral pub-sub point so both notify.ts (per-user pushes) and routes/disputes/shared.ts
// (per-case-room pushes) can emit without importing lib/realtime.ts directly — lib/realtime.ts
// registers the real Socket.IO emitters here once it's attached; until then every emit is a no-op,
// so nothing here depends on Socket.IO existing.
type ToUser = (userId: string, event: string, payload: unknown) => void;
type ToDispute = (disputeId: string, event: string, payload: unknown) => void;
type ToRole = (role: string, event: string, payload: unknown) => void;

let toUserEmitter: ToUser | null = null;
let toDisputeEmitter: ToDispute | null = null;
let toRoleEmitter: ToRole | null = null;

export function registerEmitters(emitters: { toUser: ToUser; toDispute: ToDispute; toRole: ToRole }) {
  toUserEmitter = emitters.toUser;
  toDisputeEmitter = emitters.toDispute;
  toRoleEmitter = emitters.toRole;
}

export function emitToUser(userId: string, event: string, payload: unknown) { toUserEmitter?.(userId, event, payload); }
export function emitToDisputeRoom(disputeId: string, event: string, payload: unknown) { toDisputeEmitter?.(disputeId, event, payload); }
export function emitToRoleRoom(role: string, event: string, payload: unknown) { toRoleEmitter?.(role, event, payload); }
