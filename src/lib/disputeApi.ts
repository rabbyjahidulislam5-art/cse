// Financial Dispute & Case Management System — typed client functions, same apiCall/getToken
// convention as api.ts (this file is kept separate rather than appended to the ~400-line api.ts,
// so the dispute module stays a self-contained, easily reviewable slice).
import { sessionEvents } from './session-events';
import { getAuthToken } from './auth-token';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function getToken(): string | null {
  return getAuthToken();
}

async function apiCall<T>(endpoint: string, input: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) sessionEvents.onExpire();
      throw Object.assign(new Error(data.message || 'Request failed'), data);
    }
    return data;
  } catch (err: any) {
    if (err.message?.includes('Failed to fetch') || err.name === 'TypeError') {
      throw new Error('Cannot connect to backend server. Make sure the API server is running.');
    }
    throw err;
  }
}

async function multipartCall<T>(endpoint: string, fields: Record<string, string>, files: File[]): Promise<T> {
  const token = getToken();
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  for (const file of files) formData.append('files', file);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) sessionEvents.onExpire();
    throw Object.assign(new Error(data.message || 'Request failed'), data);
  }
  return data;
}

// ─── Shared vocabulary — mirrors server/src/routes/disputes/shared.ts ───
export const DISPUTE_CATEGORIES = [
  'Wrong Receiver', 'Wrong Amount', 'Duplicate Payment', 'Merchant Issue',
  'Service Not Received', 'Failed Service', 'Payment Success But Not Reflected',
  'Accidental Payment', 'Fraud', 'Other',
] as const;
export type DisputeCategory = typeof DISPUTE_CATEGORIES[number];

export const MIN_DISPUTE_DESCRIPTION_LENGTH = 30;

export const DISPUTE_STATUSES = [
  'Open', 'Investigating', 'WaitingForStudent', 'WaitingForShop', 'WaitingForLibrary',
  'WaitingForAdmin', 'Resolved', 'Rejected', 'Refunded', 'Closed',
] as const;
export type DisputeStatus = typeof DISPUTE_STATUSES[number];

// ─── Types ───
export interface TransactionCounterpart {
  kind: 'user' | 'shop' | 'self';
  id: string;
  name: string;
  role?: string | null;
  department?: string | null;
  category?: string;
}

export interface TransactionDetail {
  transaction: {
    id: string; reference: string; type: string; direction: string; amount: number;
    serviceCharge: number | null; status: string; description: string | null;
    paymentMethod: string | null; purpose: string | null; createdAt: string; updatedAt: string;
    balanceBefore: number | null; balanceAfter: number | null;
    ipAddress: string | null; deviceInfo: string | null;
    ownerUserId: string; receiverUserId: string | null;
  };
  sender: TransactionCounterpart | null;
  receiver: TransactionCounterpart | null;
  gateway: {
    provider: string; tranId: string; bankTranId: string | null; validationId: string | null;
    confirmedVia: string | null;
    callbacks: Array<{ id: string; source: string; sslStatus: string | null; verified: boolean; createdAt: string }>;
  } | null;
  dispute: { id: string; caseNumber: string; status: DisputeStatus } | null;
  destination: { type: string; label: string; shopId?: string } | null;
}

export interface DisputeAttachmentInfo {
  id: string; originalName: string; mimeType: string; sizeBytes: number;
  scanStatus: string; createdAt: string; messageId: string | null; url: string;
}

export interface DisputeSummary {
  id: string; caseNumber: string; category: string; status: DisputeStatus;
  createdAt: string; slaDueAt: string | null; resolvedAt: string | null;
  transaction: { reference: string; amount: number; type: string } | null;
}

export interface DisputeMessageInfo {
  id: string; body: string; authorName: string; authorRole: string | null; createdAt: string;
  attachments: DisputeAttachmentInfo[];
}

export interface DisputeDetail {
  dispute: {
    id: string; caseNumber: string; category: string; description: string; status: DisputeStatus;
    priority: string; slaDueAt: string | null; frozen: boolean; assignedToName: string | null;
    createdAt: string; resolvedAt: string | null; closedAt: string | null;
  };
  transaction: TransactionDetail | null;
  messages: DisputeMessageInfo[];
  attachments: DisputeAttachmentInfo[];
  timeline: Array<{ id: string; eventType: string; summary: string; createdAt: string }>;
  statusHistory: Array<{ id: string; fromStatus: string; toStatus: string; reason: string | null; createdAt: string }>;
  refunds: Array<{ id: string; method: string; amountType: string; amount: number; status: string; processedAt: string | null; createdAt: string }>;
}

// ─── Endpoint functions ───

export const getTransactionDetail = (input: { transactionId: string }) =>
  apiCall<TransactionDetail>('/disputes/transaction-detail', input);

export const createDispute = (fields: { transactionId: string; category: DisputeCategory; description: string }, files: File[] = []) =>
  multipartCall<{ success: boolean; caseNumber: string; disputeId: string; status: DisputeStatus; skippedFiles: { name: string; reason: string }[] }>(
    '/disputes/create', fields, files
  );

export const getMyDisputes = (input: { status?: string; limit?: number; offset?: number } = {}) =>
  apiCall<{ disputes: DisputeSummary[]; total: number }>('/disputes/my', input);

export const getDisputeDetail = (input: { disputeId: string }) =>
  apiCall<DisputeDetail>('/disputes/detail', input);

export const replyToDispute = (fields: { disputeId: string; body: string }, files: File[] = []) =>
  multipartCall<{ success: boolean; messageId: string }>('/disputes/reply', fields, files);

export const closeDispute = (input: { disputeId: string; reason?: string }) =>
  apiCall<{ success: boolean }>('/disputes/close', input);

export const getDisputePdf = (input: { disputeId: string }) =>
  apiCall<{ url: string }>('/disputes/pdf', input);

export interface DisputeNotificationInfo {
  id: string; disputeId: string | null; type: string; title: string; body: string; readAt: string | null; createdAt: string;
}

export const getDisputeNotifications = () =>
  apiCall<{ notifications: DisputeNotificationInfo[]; unreadCount: number }>('/disputes/notifications', {});

export const markDisputeNotificationsRead = (input: { notificationId?: string; disputeId?: string } = {}) =>
  apiCall<{ success: boolean }>('/disputes/notifications/mark-read', input);

export const getDisputeBadgeCounts = () =>
  apiCall<{ unreadReplies: number; pendingCases: number }>('/disputes/badge-counts', {});

// ─── Accounts Office — case management, refund engine, reports ───
export const REFUND_METHODS = ['WalletCredit', 'OriginalPayment', 'ManualAdjustment'] as const;
export type RefundMethod = typeof REFUND_METHODS[number];

export interface AccountsDisputeSummary {
  id: string; caseNumber: string; category: string; status: DisputeStatus; priority: string;
  slaDueAt: string | null; frozen: boolean; createdAt: string;
  studentName: string; studentId: string; assignedToName: string | null;
  transaction: { reference: string; amount: number; type: string } | null;
}

export interface AccountsDisputeStats {
  byStatus: Record<string, number>;
  avgResolutionHours: number;
  slaOverdue: number;
  totalRefunded: number;
  refundCount: number;
}

export interface AccountsDisputeDetail {
  dispute: {
    id: string; caseNumber: string; category: string; description: string; status: DisputeStatus;
    priority: string; riskScore: number | null; slaDueAt: string | null; frozen: boolean; frozenAt: string | null;
    assignedToName: string | null; assignedToId: string | null; createdAt: string; resolvedAt: string | null; closedAt: string | null;
    mergedIntoId: string | null; splitFromId: string | null;
  };
  student: {
    id: string; fullName: string | null; email: string; studentId: string | null; department: string | null;
    batch: string | null; status: string; flagged: boolean; flagReason: string | null;
  };
  transaction: TransactionDetail | null;
  messages: (DisputeMessageInfo & { isInternal: boolean })[];
  attachments: DisputeAttachmentInfo[];
  timeline: Array<{ id: string; eventType: string; summary: string; createdAt: string }>;
  statusHistory: Array<{ id: string; fromStatus: string; toStatus: string; reason: string | null; changedByName: string; createdAt: string }>;
  refunds: Array<{ id: string; method: RefundMethod; amountType: string; amount: number; status: string; reversalTransactionId: string | null; notes: string | null; createdAt: string; processedAt: string | null }>;
  assignments: Array<{ id: string; assignedToName: string; assignedByName: string; note: string | null; createdAt: string }>;
  auditLogs: Array<{ id: string; action: string; details: string | null; ipAddress: string | null; createdAt: string }>;
  previousCases: Array<{ id: string; caseNumber: string; category: string; status: DisputeStatus; createdAt: string }>;
  relatedTransactions: Array<{ id: string; reference: string; type: string; amount: number; status: string; createdAt: string }>;
  risk: { score: number; factors: string[]; totalCases: number; rejectedCases: number };
}

export const getAccountsDisputeStats = () =>
  apiCall<AccountsDisputeStats>('/accounts/disputes/stats', {});

export const getAccountsDisputeList = (input: { status?: string; assignedToMe?: boolean; search?: string; limit?: number; offset?: number } = {}) =>
  apiCall<{ disputes: AccountsDisputeSummary[]; total: number }>('/accounts/disputes/list', input);

export const getAccountsDisputeDetail = (input: { disputeId: string }) =>
  apiCall<AccountsDisputeDetail>('/accounts/disputes/detail', input);

export const getAccountsOfficers = () =>
  apiCall<{ officers: Array<{ id: string; fullName: string | null; email: string }> }>('/accounts/disputes/officers', {});

export const assignDispute = (input: { disputeId: string; assignedToId: string; note?: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/assign', input);

export const replyToAccountsDispute = (fields: { disputeId: string; body: string; isInternal?: boolean }, files: File[] = []) =>
  multipartCall<{ success: boolean; messageId: string }>('/accounts/disputes/reply', { disputeId: fields.disputeId, body: fields.body, isInternal: String(!!fields.isInternal) }, files);

export const requestDocuments = (input: { disputeId: string; details: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/request-documents', input);

export const freezeDispute = (input: { disputeId: string; reason?: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/freeze', input);

export const unfreezeDispute = (input: { disputeId: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/unfreeze', input);

export const getAccountsShops = () =>
  apiCall<{ shops: Array<{ id: string; name: string; category: string }> }>('/accounts/disputes/shops', {});

export const forwardDispute = (input: { disputeId: string; to: 'Shop' | 'Library' | 'Admin'; shopId?: string; note?: string; highPriority?: boolean }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/forward', input);

export const escalateDispute = (input: { disputeId: string; reason?: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/escalate', input);

export const resolveDispute = (input: { disputeId: string; resolutionNote: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/resolve', input);

export const rejectDispute = (input: { disputeId: string; reason: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/reject', input);

export const initiateRefund = (input: { disputeId: string; method: RefundMethod; amountType: 'Full' | 'Partial'; amount?: number; notes?: string }) =>
  apiCall<{ success: boolean; refundId: string; status: string; requiresAdminApproval: boolean }>('/accounts/disputes/refund/initiate', input);

export const rejectRefund = (input: { refundId: string; reason: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/refund/reject', input);

export const mergeDisputes = (input: { sourceDisputeId: string; targetDisputeId: string; note?: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/merge', input);

export const splitDispute = (input: { disputeId: string; category: string; description: string }) =>
  apiCall<{ success: boolean; caseNumber: string; disputeId: string }>('/accounts/disputes/split', input);

export const closeAccountsDispute = (input: { disputeId: string }) =>
  apiCall<{ success: boolean }>('/accounts/disputes/close', input);

export const generateDisputeReport = (input: { format: 'csv' | 'excel' | 'pdf'; status?: string; fromDate?: string; toDate?: string }) =>
  apiCall<{ url: string }>('/accounts/disputes/report', input);

// ─── Admin — Case Oversight, staff performance, fraud detection, high-value refund approval ───
export interface AdminDisputeStats {
  total: number; byStatus: Record<string, number>; escalations: number; pendingSla: number;
  totalRefunded: number; refundCount: number; pendingApprovals: number;
}
export interface StaffPerformance { id: string; name: string; assigned: number; resolved: number; avgResolutionHours: number }
export interface FraudSignals {
  repeatedDisputers: Array<{ userId: string; name: string; studentId: string; flagged: boolean; disputeCount: number }>;
  repeatedShops: Array<{ shopId: string; name: string; flagged: boolean; status: string; disputeCount: number }>;
  repeatedFailures: number;
  fraudCategoryCount: number;
}

export const getAdminDisputeStats = () => apiCall<AdminDisputeStats>('/admin/disputes/stats', {});
export const getStaffPerformance = () => apiCall<{ performance: StaffPerformance[] }>('/admin/disputes/staff-performance', {});
export const getFraudSignals = () => apiCall<FraudSignals>('/admin/disputes/fraud-signals', {});
export const getAdminDisputeList = (input: { scope?: 'active' | 'completed'; mineOnly?: boolean; search?: string; limit?: number; offset?: number } = {}) =>
  apiCall<{ disputes: AccountsDisputeSummary[]; total: number }>('/admin/disputes/list', input);
export const getAdminDisputeDetail = (input: { disputeId: string }) => apiCall<AccountsDisputeDetail>('/admin/disputes/detail', input);
export const getAdminShops = () =>
  apiCall<{ shops: Array<{ id: string; name: string; category: string }> }>('/admin/disputes/shops', {});
export const forwardDisputeAdmin = (input: { disputeId: string; to: 'Shop' | 'Library'; shopId?: string; note?: string }) =>
  apiCall<{ success: boolean }>('/admin/disputes/forward', input);
export const refundDisputeAdmin = (input: { disputeId: string; method: RefundMethod; amountType: 'Full' | 'Partial'; amount?: number; notes: string }) =>
  apiCall<{ success: boolean; refundId: string }>('/admin/disputes/refund', input);
export const rejectDisputeAdmin = (input: { disputeId: string; reason: string }) =>
  apiCall<{ success: boolean }>('/admin/disputes/reject', input);
export const approveRefundAdmin = (input: { refundId: string; notes?: string }) =>
  apiCall<{ success: boolean }>('/admin/disputes/refund/approve', input);
export const rejectRefundAdmin = (input: { refundId: string; reason: string }) =>
  apiCall<{ success: boolean }>('/admin/disputes/refund/reject', input);
export const freezeWallet = (input: { userId: string; freeze: boolean; disputeId?: string }) =>
  apiCall<{ success: boolean }>('/admin/disputes/freeze-wallet', input);
export const lockAccount = (input: { userId: string; lock: boolean; disputeId?: string }) =>
  apiCall<{ success: boolean }>('/admin/disputes/lock-account', input);
export const flagUser = (input: { userId: string; flag: boolean; reason?: string; disputeId?: string }) =>
  apiCall<{ success: boolean }>('/admin/disputes/flag-user', input);
export const flagMerchant = (input: { shopId: string; flag: boolean; disputeId?: string }) =>
  apiCall<{ success: boolean }>('/admin/disputes/flag-merchant', input);
export const generateAdminDisputeReport = (input: { format: 'csv' | 'excel' | 'pdf'; status?: string; fromDate?: string; toDate?: string }) =>
  apiCall<{ url: string }>('/admin/disputes/report', input);

// ─── Library — dispute inbox, recommendations forwarded to Accounts ───
export interface RoleDisputeSummary {
  id: string; caseNumber: string; category: string; status: DisputeStatus; createdAt: string;
  studentName: string; studentId: string;
  transaction: { reference: string; amount: number; type: string } | null;
}

export const getLibraryDisputeList = (input: { limit?: number; offset?: number } = {}) =>
  apiCall<{ disputes: RoleDisputeSummary[]; total: number }>('/library/disputes/list', input);
export const getLibraryDisputeDetail = (input: { disputeId: string }) => apiCall<AccountsDisputeDetail>('/library/disputes/detail', input);
export const replyToLibraryDispute = (fields: { disputeId: string; body: string; isInternal?: boolean }, files: File[] = []) =>
  multipartCall<{ success: boolean; messageId: string }>('/library/disputes/reply', { disputeId: fields.disputeId, body: fields.body, isInternal: String(!!fields.isInternal) }, files);
export const recommendLibraryDecision = (input: { disputeId: string; decision: 'Approve' | 'Reject' | 'Waive'; note?: string }) =>
  apiCall<{ success: boolean }>('/library/disputes/recommend', input);

// ─── Shop — dispute inbox, reply + upload proof ───
export const getShopDisputeList = (input: { status?: string; limit?: number; offset?: number } = {}) =>
  apiCall<{ disputes: RoleDisputeSummary[]; total: number }>('/shop/disputes/list', input);
export const getShopDisputeDetail = (input: { disputeId: string }) => apiCall<AccountsDisputeDetail>('/shop/disputes/detail', input);
export const replyToShopDispute = (fields: { disputeId: string; body: string; isInternal?: boolean }, files: File[] = []) =>
  multipartCall<{ success: boolean; messageId: string }>('/shop/disputes/reply', { disputeId: fields.disputeId, body: fields.body, isInternal: String(!!fields.isInternal) }, files);
export const recommendShopDecision = (input: { disputeId: string; decision: 'Approve' | 'Reject' | 'Waive'; note?: string }) =>
  apiCall<{ success: boolean }>('/shop/disputes/recommend', input);
