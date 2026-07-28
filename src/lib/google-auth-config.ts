// Google OAuth client IDs always look like `<digits>-<hash>.apps.googleusercontent.com`.
// Checking the shape (not just presence) catches a truncated/misplaced env value, not only a missing one.
const CLIENT_ID_PATTERN = /^\d+-[0-9a-z]+\.apps\.googleusercontent\.com$/i;

export function getGoogleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';
}

export function isValidGoogleClientId(clientId: string): boolean {
  return CLIENT_ID_PATTERN.test(clientId);
}
