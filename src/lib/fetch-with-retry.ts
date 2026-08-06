// Render's free tier spins the backend down after ~15 minutes of no traffic; the first request
// after that gets no response at all (fetch throws TypeError, not an HTTP error) while it cold-boots.
// Retrying with backoff absorbs that window instead of surfacing a hard "can't connect" error
// for what is usually just the backend waking back up.
const RETRY_DELAYS_MS = [3000, 6000, 10000];

export function isNetworkError(err: any): boolean {
  return err?.message?.includes('Failed to fetch') || err?.name === 'TypeError';
}

export async function fetchWithRetry(input: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err: any) {
      if (!isNetworkError(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}
