// SSLCommerz's refund API — confusingly, it's the *same* merchantTransIDvalidationAPI.php
// endpoint used to confirm checkouts, just called with refund_amount/refund_remarks/bank_tran_id
// instead of tran_id (verified against SSLCommerz's own official Node SDK, which points both
// initiateRefund() and the payment validator at this identical path). Called when a dispute
// refund is issued back to the original payment method rather than as a wallet credit, so the
// money actually moves through the gateway instead of just being logged as a manual note.
export function sslRefundInitiateUrl() {
  const isLive = process.env.SSLCOMMERZ_IS_LIVE === 'true';
  return isLive
    ? 'https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php'
    : 'https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php';
}

export interface SslRefundResult {
  success: boolean;
  refundRefId?: string;
  status?: string;
  message: string;
}

export async function callSslCommerzRefund(input: {
  bankTranId: string;
  amount: number;
  remarks: string;
  refeId?: string;
}): Promise<SslRefundResult> {
  const { bankTranId, amount, remarks, refeId } = input;
  try {
    const params = new URLSearchParams({
      bank_tran_id: bankTranId,
      refund_amount: String(amount),
      refund_remarks: remarks,
      store_id: process.env.SSLCOMMERZ_STORE_ID || '',
      store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD || '',
      format: 'json',
    });
    if (refeId) params.set('refe_id', refeId);

    const response = await fetch(`${sslRefundInitiateUrl()}?${params.toString()}`);
    const data = (await response.json()) as Record<string, unknown>;

    const apiConnect = (data.APIConnect as string) || '';
    const status = ((data.status as string) || '').toLowerCase();
    if (apiConnect === 'DONE' || status === 'processing' || status === 'success') {
      return {
        success: true,
        refundRefId: data.refund_ref_id as string,
        status,
        message: `SSLCommerz refund initiated (${status || 'processing'}).`,
      };
    }
    return {
      success: false,
      status,
      message: (data.errorReason as string) || (data.error as string) || 'SSLCommerz refund initiation failed.',
    };
  } catch (err: any) {
    return { success: false, message: `Could not reach SSLCommerz refund API: ${err.message || err}` };
  }
}
