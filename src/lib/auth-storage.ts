// Unified Auth Storage Module supporting both standard production shared sessions (localStorage)
// and isolated per-tab sessions (sessionStorage) for multi-account testing & development.

const PER_TAB_KEY = 'dev_per_tab_auth';
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export function isPerTabAuthMode(): boolean {
  if (import.meta.env.VITE_PER_TAB_AUTH === 'true') return true;
  try {
    return localStorage.getItem(PER_TAB_KEY) === 'true' || sessionStorage.getItem(PER_TAB_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPerTabAuthMode(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(PER_TAB_KEY, 'true');
      sessionStorage.setItem(PER_TAB_KEY, 'true');
      const token = localStorage.getItem(TOKEN_KEY);
      const user = localStorage.getItem(USER_KEY);
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      if (user) sessionStorage.setItem(USER_KEY, user);
    } else {
      localStorage.removeItem(PER_TAB_KEY);
      sessionStorage.removeItem(PER_TAB_KEY);
    }
  } catch { /* ignore storage errors */ }
}

export function getStoredToken(): string | null {
  try {
    if (isPerTabAuthMode()) {
      const sessionToken = sessionStorage.getItem(TOKEN_KEY);
      if (sessionToken) return sessionToken;
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (!token) {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_KEY, token);
  } catch { /* ignore storage errors */ }
}

export function getStoredUser(): any | null {
  try {
    let raw: string | null = null;
    if (isPerTabAuthMode()) {
      raw = sessionStorage.getItem(USER_KEY);
    }
    if (!raw) {
      raw = localStorage.getItem(USER_KEY);
    }
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: any): void {
  try {
    if (!user) {
      sessionStorage.removeItem(USER_KEY);
      localStorage.removeItem(USER_KEY);
      return;
    }
    const raw = JSON.stringify(user);
    sessionStorage.setItem(USER_KEY, raw);
    localStorage.setItem(USER_KEY, raw);
  } catch { /* ignore storage errors */ }
}

export function clearStoredAuth(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore storage errors */ }
}
