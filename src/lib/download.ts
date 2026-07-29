// `window.open(url)` called after an `await` (e.g. the network round-trip to generate a report)
// is no longer inside the trusted click-gesture window most browsers require to allow a popup —
// mobile Safari, Chrome on Android, and desktop Chrome with strict popup settings all silently
// block it, with no error thrown, so the button just appears to do nothing. A programmatically
// clicked <a> element isn't subject to that popup-blocker heuristic, so it works reliably
// regardless of how long the preceding async work took.
export function triggerDownload(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
