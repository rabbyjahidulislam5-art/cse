import { cancelPayment } from './api';

const REDIRECT_TIMEOUT_MS = 3500;

/**
 * Navigates to an SSLCommerz gatewayUrl and detects when the browser silently blocks/fails the
 * redirect (security software, in-app browser, unreachable host) instead of leaving an orphaned
 * Pending transaction behind. A real navigation tears this JS context down, so the timeout body
 * can only ever run in the genuine-failure case.
 */
export function redirectToPaymentGateway(
  gatewayUrl: string | undefined | null,
  transactionRef: string | undefined,
  onFail: () => void,
): void {
  if (!gatewayUrl) {
    if (transactionRef) cancelPayment({ transactionRef }).catch(() => {});
    onFail();
    return;
  }

  let left = false;
  const cleanup = () => {
    window.removeEventListener('pagehide', onLeave);
    window.removeEventListener('visibilitychange', onLeave);
    clearTimeout(timer);
  };
  const onLeave = () => {
    left = true;
    cleanup();
  };

  window.addEventListener('pagehide', onLeave);
  window.addEventListener('visibilitychange', onLeave);

  const timer = setTimeout(() => {
    if (left || document.visibilityState !== 'visible') return;
    cleanup();
    if (transactionRef) cancelPayment({ transactionRef }).catch(() => {});
    onFail();
  }, REDIRECT_TIMEOUT_MS);

  window.location.href = gatewayUrl;
}
