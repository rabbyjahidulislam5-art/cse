// The single source of truth this tab uses for outgoing requests (HTTP + socket auth).
//
// Deliberately NOT a live `localStorage.getItem()` on every call. localStorage is shared by every
// tab of the same origin, so reading it fresh on each request means one tab logging in, logging
// out, or switching accounts silently changes which account *every other open tab* authenticates
// as on its very next request — the tab's own UI keeps showing its own route/page, but the data
// coming back starts belonging to a different account. That's the actual mechanism behind
// "changing dashboards in one tab changes another tab": it's not route state syncing, it's the
// credential underneath every fetch getting swapped out from under an already-open tab.
//
// Each browser tab gets its own instance of this module (a fresh JS realm per tab), so the
// module-level variable below is naturally already tab-scoped. It's captured once from
// localStorage at load (so a new tab opened while already logged in inherits the session, same as
// Gmail/Facebook) and after that is only ever changed by this tab's own explicit auth actions, or
// by the controlled cross-tab listener in auth-context.tsx (see the comment there for exactly
// which cross-tab events are allowed to reach it).
import { getStoredToken } from './auth-storage';

let inMemoryToken: string | null = getStoredToken();

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

/** Reads the `id` field out of a JWT's payload without verifying it — verification is the
 * server's job; this is only ever used client-side to answer "is this the same account as
 * before", never as an authorization decision. */
export function decodeTokenUserId(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).id ?? null;
  } catch {
    return null;
  }
}
