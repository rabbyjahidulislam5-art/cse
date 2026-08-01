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
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        throw new Error('Backend URL is not connected to Vercel. Please set VITE_API_URL in Vercel Settings.');
      } else {
        throw new Error('Backend server is not running on localhost (port 4000).');
      }
    }
    const data = await res.json();
    if (!res.ok) {
      // 401 here only ever means authMiddleware rejected the token (missing/invalid/expired) —
      // role/permission failures are 403 and don't hit this. Auto-logout this tab and drop back
      // to the login card instead of leaving every open page silently broken.
      if (res.status === 401) sessionEvents.onExpire();
      // Attach any extra fields the server sent (e.g. requiresPin/requiresOtp on a 403 from
      // /payment/init) so callers can react to the specific reason, not just show a generic error.
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

// ─── Type exports ───

export type GetStudentDashboardOutputType = {
  user: {
    id: string; fullName: string; email: string; studentId: string;
    department: string; batch: string; phone: string; status: string;
    pinSet: boolean; pinLength: number; profilePicture: string; emergencyContact: string;
    address: string; bloodGroup: string; gender: string; dateOfBirth: string; bio: string;
  };
  wallet: { id: string; balance: number };
  recentTransactions: Array<{
    id: string; reference: string; type: string; direction: string;
    amount: number; status: string; description: string; paymentMethod: string; gateway: string;
  }>;
};

export type GetShopsOutputType = {
  shops: Array<{
    id: string; name: string; category: string; rating: number;
    status: string; location: string; logoUrl: string;
  }>;
};

export type GetShopDetailOutputType = {
  shop: {
    id: string; name: string; category: string; rating: number;
    status: string; location: string; logoUrl: string; qrToken: string; merchantId: string;
    description: string; operatingHours: string; contactNumber: string;
    ownerName: string; ownerEmail: string;
  };
};

export type GetDuesOutputType = {
  semester: DueItem[]; library: DueItem[]; admin: DueItem[]; payLater: DueItem[];
};
type DueItem = {
  id: string; source: string; label: string; amount: number; status: string; dueDate: string; reference?: string;
  // Admin fine items only — issuing administrator + issue date, for full audit visibility.
  issuedAt?: string; issuedByName?: string;
};

export type GetTransactionsOutputType = {
  transactions: Array<{
    id: string; reference: string; type: string; direction: string;
    amount: number; status: string; description: string; paymentMethod: string;
    gateway: string; createdAt?: string;
  }>;
  hasMore: boolean;
  total: number;
  statusCounts?: Record<string, number>;
};

export type NotificationItem = {
  id: string; source: 'general' | 'dispute'; category: string; type: string;
  title: string; body: string; link: string; read: boolean; createdAt: string;
};

export type GetNotificationsOutputType = {
  notifications: NotificationItem[];
  unreadCount: number;
};

export type GetAdminOverviewOutputType = {
  totalStudents: number; totalShops: number; totalTransactions: number;
  totalRevenue: number; pendingFines: number;
  activeShops?: number; suspendedShops?: number;
  // Fine issuance monitoring only — Admin Office issues fines but is never their payment
  // receiver, so deliberately no amount-owed total here. Accounts Office owns the receivable
  // view (getAccountsAdminFines).
  finesIssuedCount?: number; finesPendingCount?: number; finesPaidCount?: number; finesCancelledCount?: number;
  recentActivity: Array<{
    id: string; action: string; actor: string; entityType: string; details: string; createdAt: string;
  }>;
};

export type GetAdminShopsOutputType = {
  shops: Array<{
    id: string; name: string; category: string; rating: number;
    status: string; location: string; logoUrl: string; merchantId: string; qrToken: string;
    ownerEmail: string; ownerName: string; contactNumber: string;
    mustChangePassword: boolean; emailVerified: boolean;
    totalReceived: number; totalSettled: number; pendingSettlement: number;
  }>;
};

export type GetAuditLogsOutputType = {
  logs: Array<{
    id: string; action: string; actor: string; actorName: string;
    entityType: string; entityId: string; details: string; ipAddress: string; createdAt: string;
  }>;
  total: number;
  hasMore: boolean;
};

export type GetStaffOutputType = {
  staff: Array<{
    id: string; fullName: string; email: string; role: string;
    phone: string; status: string; department: string;
  }>;
};

export type SearchStudentsOutputType = {
  students: Array<{
    id: string; fullName: string; email: string; studentId: string;
    department: string; batch: string; status: string;
  }>;
};

export type GetWaiversOutputType = {
  waivers: Array<{
    id: string; type: string; label: string; amount: number;
    studentName: string; studentEmail: string; studentId?: string; status: string;
    reason: string; createdAt: string;
  }>;
};

export type GetLibraryOverviewOutputType = {
  totalFinesOutstanding: number;
  fineAmount: number;
  studentsPendingClearance: number;
  recentFines: Array<{
    id: string; label: string; amount: number; status: string; studentName: string;
  }>;
};

export type LibraryStudentLookupOutputType = {
  students: Array<{
    id: string; fullName: string; email: string; studentId: string;
    department: string; batch: string;
    fines: Array<{ id: string; label: string; fineType: string; amount: number; status: string; dueDate: string }>;
    totalPending: number;
  }>;
};

export type GetLibraryClearanceOutputType = {
  students: Array<{
    id: string; fullName: string; studentId: string; department: string; batch: string;
    status: 'Cleared' | 'Unpaid'; pendingAmount: number; pendingCount: number;
  }>;
  departments: string[];
};

export type GetAccountsOverviewOutputType = {
  totalFees: number; totalCollected: number; totalPending: number;
  collectionRate: number;
  totalPaid?: number; totalOutstanding?: number; collectionPercent?: number;
  pendingCount?: number; totalAssigned?: number; totalStudents?: number;
  recentPayments: Array<{
    id: string; studentName: string; amount: number; status: string; date: string;
  }>;
};

export type GetCollectionAnalyticsOutputType = {
  byDepartment: Array<{ department: string; total: number; paid: number; pending: number }>;
  byStatus: Array<{ status: string; count: number; amount: number }>;
  timeline: Array<{ date: string; amount: number }>;
  totalStudents: number; totalFees: number; collected: number; collectionRate: number;
  overall?: any;
  departments: Array<{ name: string; collected: number; pending: number; percent: number; students?: number; pendingAmount?: number }>;
};

export type GetShopDashboardOutputType = {
  shop: {
    id: string; name: string; category: string; rating?: number;
    status: string; location: string; logoUrl?: string; merchantId: string; qrToken: string;
    qrSignature?: string; contactNumber?: string; description?: string; operatingHours?: string;
  };
  owner: {
    fullName: string; email: string; phone: string; profilePicture: string; bio: string;
    pinSet: boolean; pinLength: number;
  };
  wallet: { id: string; balance: number };
  todayRevenue: number; todayCount: number; totalRevenue: number; totalCount?: number;
  totalSettled: number; pendingSettlement: number;
  recentTransactions: Array<{
    id: string; reference: string; amount: number; status: string;
    type?: string; description: string; paymentMethod?: string; createdAt?: string;
  }>;
  pendingPayLater?: Array<{
    id: string; reference: string; amount: number; status: string;
    studentName: string; dueDate: string; description: string;
  }>;
  recentSettlements?: Array<{ id: string; amount: number; notes: string; settledAt: string }>;
};

export type ValidateQrMerchantOutputType = {
  valid: boolean;
  shop: {
    id: string; name: string; category: string; location: string; merchantId: string; logoUrl?: string;
  } | null;
  message: string;
};

// ─── Endpoint functions ───

export const getStudentDashboard = (input: Record<string, unknown> = {}) =>
  apiCall<GetStudentDashboardOutputType>('/student/dashboard', input);

export const getShops = (input: Record<string, unknown> = {}) =>
  apiCall<GetShopsOutputType>('/shops', input);

export const getShopDetail = (input: { shopId: string }) =>
  apiCall<GetShopDetailOutputType>('/shops/detail', input);

export const getDues = (input: Record<string, unknown> = {}) =>
  apiCall<GetDuesOutputType>('/dues', input);

export const disputeFine = (input: { fineId: string; source?: string; reason: string }) =>
  apiCall<{ success: boolean; message: string }>('/fines/dispute', input);

export const getTransactions = (input: Record<string, unknown> = {}) =>
  apiCall<GetTransactionsOutputType>('/transactions', input);

export const getNotifications = (input: { category?: string; unreadOnly?: boolean; search?: string } = {}) =>
  apiCall<GetNotificationsOutputType>('/notifications', input);

export const getUnreadNotificationCount = () =>
  apiCall<{ unreadCount: number }>('/notifications/unread-count', {});

export const markNotificationRead = (input: { id?: string; source?: 'general' | 'dispute' } = {}) =>
  apiCall<{ success: boolean }>('/notifications/mark-read', input);

export const getReceipt = (input: { transactionId: string }) =>
  apiCall<{ url: string;[key: string]: any }>('/receipt', input);

export const lookupTransferRecipient = (input: { recipientIdentifier: string }) =>
  apiCall<{ found: boolean; recipient: { id: string; fullName: string; email: string; studentId: string; department: string; batch: string } }>('/transfer/lookup', input);

export const transferMoney = (input: { recipientIdentifier: string; amount: number; note?: string }) =>
  apiCall<{ success: boolean; newBalance: number; transactionId: string; recipientName: string }>('/transfer', input);

export const payShop = (input: { shopId: string; shopName: string; amount: number; description?: string }) =>
  apiCall<{ success: boolean; transactionId: string; dueId?: string }>('/shops/pay', input);

export const validateQrMerchant = (input: { qrData: string }) =>
  apiCall<ValidateQrMerchantOutputType>('/shops/validate-qr', input);

export type SslPayItem = { id: string; source: 'semester' | 'library' | 'admin' | 'payLater' | 'shop' | 'wallet'; amount: number; label: string };

export const initSSLPayment = (input: { items: SslPayItem[]; purpose: 'semester_fee' | 'library_fine' | 'admin_fine' | 'pay_later' | 'shop_payment' | 'mass_pay' | 'wallet_topup'; itemLabel?: string; amount?: number; otpId?: string }) =>
  apiCall<{ gatewayUrl: string; transactionRef: string; sessionKey: string }>('/payment/init', input);

export const initWalletTopUp = (input: { amount: number; otpId?: string }) =>
  apiCall<{ gatewayUrl: string; transactionRef: string; sessionKey: string }>('/payment/init', {
    purpose: 'wallet_topup',
    amount: input.amount,
    items: [],
    itemLabel: `Wallet Top-Up — ৳${input.amount.toLocaleString()}`,
    otpId: input.otpId,
  });

export const cancelPayment = (input: { transactionRef: string }) =>
  apiCall<{ cancelled: boolean }>('/payment/cancel', input);

export const withdrawFromWallet = (input: { amount: number; mobileNumber: string; provider?: string }) =>
  apiCall<{ success: boolean; newBalance: number; transactionId: string; reference: string; message: string }>('/wallet/withdraw', input);

// Unified Outstanding Due Settlement — a bundled item pulled in alongside the Semester Fee
// (library fine, admin fine, or shop pay-later due), shown so the student sees exactly what a
// single consolidated payment covers before paying.
export type SettlementItem = { source: string; label: string; amount: number };
export type SettlementBreakdown = { semester: number; library: number; admin: number; payLater: number };

export type SemesterFeeLookupOutputType = {
  found: boolean;
  student?: { fullName: string; studentId: string; department: string; batch: string };
  totalDue: number;
  feeCount: number;
  fees: Array<{ id: string; label: string; amount: number; dueDate: string }>;
  items?: SettlementItem[];
  breakdown?: SettlementBreakdown;
};

export type PaySemesterFeeOutputType = {
  success: boolean;
  method: 'wallet' | 'sslcommerz';
  amount: number;
  reference?: string;
  transactionRef?: string;
  sessionKey?: string;
  newBalance?: number;
  paidByName?: string;
  studentName?: string;
  gatewayUrl?: string;
  items?: SettlementItem[];
  breakdown?: SettlementBreakdown;
};

export type FinancialStatusOutputType = {
  restricted: boolean;
  reason: string | null;
  overdueFees: Array<{ id: string; label: string; amount: number; dueDate: string }>;
  totalOutstanding: number;
};

export const getFinancialStatus = () =>
  apiCall<FinancialStatusOutputType>('/student/financial-status', {});

export type StudentOutstandingDuesOutputType = {
  found: boolean;
  student: { fullName: string; studentId: string; department: string; batch: string };
  items: SettlementItem[];
  total: number;
  breakdown: SettlementBreakdown;
  restricted: boolean;
  reason: string | null;
};

export const getStudentOutstandingDues = (input: { studentId: string }) =>
  apiCall<StudentOutstandingDuesOutputType>('/accounts/student-outstanding-dues', input);

export type RecordManualPaymentOutputType = {
  success: boolean;
  reference: string;
  amount: number;
  items: SettlementItem[];
  breakdown: SettlementBreakdown;
  wasRestricted: boolean;
  studentName: string;
};

export const recordManualBankPayment = (input: { studentId: string; bankReference: string; amountReceived: number; note?: string }) =>
  apiCall<RecordManualPaymentOutputType>('/accounts/manual-payment/record', input);

export const lookupSemesterFeeStudent = (input: { studentId: string }) =>
  apiCall<SemesterFeeLookupOutputType>('/semester-fees/lookup', input);

export const paySemesterFee = (input: { studentId: string; method: 'wallet' | 'sslcommerz'; otpId?: string }) =>
  apiCall<PaySemesterFeeOutputType>('/semester-fees/pay', input);

// Thresholds mirrored from server/src/index.ts's PIN_REQUIRED_THRESHOLD / OTP_REQUIRED_THRESHOLD —
// used client-side purely for UX (showing the right dialog before the redirect); the server enforces
// the real gate independently and never trusts these being checked on the client.
export const PIN_REQUIRED_THRESHOLD = 3000;
export const OTP_REQUIRED_THRESHOLD = 20000;

export const validateSSLPayment = (input: { transactionRef: string }): Promise<{ status: 'valid' | 'failed' | 'pending'; message: string }> =>
  apiCall<{ status: 'valid' | 'failed' | 'pending'; message: string }>('/payment/validate', input);

export const updateProfile = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; message: string }>('/profile/update', input);

export const setPin = (input: { pin: string; currentPin?: string }) =>
  apiCall<{ success: boolean; message: string }>('/pin/set', input);

export const verifyPin = (input: { pin: string }) =>
  apiCall<{ valid: boolean; message: string }>('/pin/verify', input);

export const sendOtp = (input: { purpose: string }) =>
  apiCall<{ success: boolean; message: string; otpId: string; expiresAt: string }>('/otp/send', input);

export const verifyOtp = (input: { otpId: string; code: string }) =>
  apiCall<{ valid: boolean; message: string }>('/otp/verify', input);

// Admin endpoints
export const getAdminOverview = (input: Record<string, unknown> = {}) =>
  apiCall<GetAdminOverviewOutputType>('/admin/overview', input);

export const seedData = (input: Record<string, unknown> = {}) =>
  apiCall<{ success: boolean; message: string }>('/admin/seed', input);

export const getAdminShops = (input: Record<string, unknown> = {}) =>
  apiCall<GetAdminShopsOutputType>('/admin/shops', input);

export const manageShop = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; message: string; shopId?: string; merchantId?: string; emailDelivered?: boolean; tempPassword?: string }>('/admin/shops/manage', input);

export const getAuditLogs = (input: Record<string, unknown> = {}) =>
  apiCall<GetAuditLogsOutputType>('/admin/audit-logs', input);

export const generateAuditLogReport = (input: { format: 'csv' | 'excel' | 'pdf'; action?: string; entityType?: string }) =>
  apiCall<{ url: string }>('/admin/audit-logs/report', input);

export const getStaff = (input: Record<string, unknown> = {}) =>
  apiCall<GetStaffOutputType>('/admin/staff', input);

export const manageStaff = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; message: string }>('/admin/staff/manage', input);

export const searchStudents = (input: { query: string }) =>
  apiCall<SearchStudentsOutputType>('/admin/search-students', input);

export const assignFine = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; fineId: string; message: string }>('/admin/fines/assign', input);

export const getWaivers = (input: Record<string, unknown> = {}) =>
  apiCall<GetWaiversOutputType>('/admin/waivers', input);

export const updateWaiver = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; message: string }>('/admin/waivers/update', input);

// Admin's own issued-fines list — status monitoring only, Cancel/Edit (Pending fines only). Admin
// Office never touches payment/reconciliation state; that lives on the Accounts side below.
export type ListAdminFinesOutputType = {
  fines: Array<{
    id: string; reason: string; amount: number; reference: string; status: string;
    incidentDate: string; createdAt: string; studentName: string; studentId: string;
  }>;
};

export const listAdminFines = (input: { status?: string; search?: string } = {}) =>
  apiCall<ListAdminFinesOutputType>('/admin/fines/list', input);

export const cancelAdminFine = (input: { fineId: string; reason?: string }) =>
  apiCall<{ success: boolean; message: string }>('/admin/fines/cancel', input);

export const updateAdminFine = (input: { fineId: string; reason?: string; amount?: number; incidentDate?: string }) =>
  apiCall<{ success: boolean; message: string }>('/admin/fines/update', input);

// Accounts Office — Administrative Fines (the actual financial/receivable view). Admin Office's
// fine data feeds this directly; Accounts Office is the sole financial authority that collects
// and reconciles payment.
export type AdminFineRow = {
  id: string; reason: string; amount: number; reference: string; status: string;
  incidentDate: string; createdAt: string; updatedAt: string;
  student: { id: string; fullName: string; studentId: string; email: string };
  issuedBy: { id: string; fullName: string; email: string } | null;
  cancelledAt: string | null; reconciledAt: string | null;
};

export type ListAccountsAdminFinesOutputType = {
  fines: AdminFineRow[]; total: number; page: number; pageSize: number; statusCounts: Record<string, number>;
};

export const listAccountsAdminFines = (input: { status?: string; search?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number } = {}) =>
  apiCall<ListAccountsAdminFinesOutputType>('/accounts/admin-fines', input);

export type AccountsAdminFineDetailOutputType = {
  fine: AdminFineRow;
  transaction: { id: string; reference: string; status: string; amount: number; paymentMethod: string; updatedAt: string } | null;
  ledgerEntries: Array<{ id: string; entryNumber: string; type: string; debitAmount: number; creditAmount: number; balanceAfter: number; createdAt: string }>;
  auditTrail: Array<{ id: string; action: string; actorName: string; details: string; createdAt: string }>;
};

export const getAccountsAdminFineDetail = (input: { fineId: string }) =>
  apiCall<AccountsAdminFineDetailOutputType>('/accounts/admin-fines/detail', input);

export const reconcileAdminFine = (input: { fineId: string }) =>
  apiCall<{ success: boolean; message: string }>('/accounts/admin-fines/reconcile', input);

// Accounts Office QR — singleton (mirrors Library). Scanning it opens the payment-category
// chooser rather than one flat payment, since Accounts collects many payment categories.
export const getAccountsQr = (input: Record<string, unknown> = {}) =>
  apiCall<{ office: { id: string; name: string; qrToken: string; qrSignature?: string } }>('/accounts/qr/details', input);

export const regenerateAccountsQr = (input: Record<string, unknown> = {}) =>
  apiCall<{ success: boolean; qrToken: string; message: string }>('/accounts/qr/regenerate', input);

export const validateAccountsQr = (input: { qrData: string }) =>
  apiCall<{ valid: boolean; office?: { id: string; name: string }; message?: string }>('/accounts/qr/validate', input);

// Library endpoints
export const getLibraryOverview = (input: Record<string, unknown> = {}) =>
  apiCall<GetLibraryOverviewOutputType>('/library/overview', input);

export const libraryStudentLookup = (input: { identifier?: string; query?: string }) =>
  apiCall<LibraryStudentLookupOutputType>('/library/student-lookup', input);

export const assignLibraryFine = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; fineId: string; message: string }>('/library/fines/assign', input);

export const waiveLibraryFine = (input: { fineId: string; reason?: string; action?: string; newAmount?: number }) =>
  apiCall<{ success: boolean; message: string }>('/library/fines/waive', input);

export const getLibraryClearance = (input: Record<string, unknown> = {}) =>
  apiCall<GetLibraryClearanceOutputType>('/library/clearance', input);

export const generateClearanceReport = (input: { format: 'csv' | 'excel' | 'pdf'; department?: string }) =>
  apiCall<{ url: string }>('/library/clearance/report', input);

// Accounts endpoints
export const getAccountsOverview = (input: Record<string, unknown> = {}) =>
  apiCall<GetAccountsOverviewOutputType>('/accounts/overview', input);

export const pushSemesterFee = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; message: string; count: number }>('/accounts/fee-push', input);

export const adjustSemesterFee = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; message: string }>('/accounts/fee-adjust', input);

export const getCollectionAnalytics = (input: Record<string, unknown> = {}) =>
  apiCall<GetCollectionAnalyticsOutputType>('/accounts/analytics', input);

export const generateCollectionAnalyticsReport = (input: { format: 'csv' | 'excel' | 'pdf' }) =>
  apiCall<{ url: string }>('/accounts/analytics/report', input);

// ─── EWU Fee Management Redesign API Endpoints ───

export const exportAdvisingFees = async (format: 'excel' | 'csv' | 'pdf') => {
  const token = getToken();
  const res = await fetch(`${API_URL}/advising/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ format }),
  });
  if (!res.ok) throw new Error('Advising export failed');
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `advising_completed_fees.${format === 'excel' ? 'xlsx' : format}`;
  a.click();
};

export const downloadFeeImportTemplate = async () => {
  const token = getToken();
  const res = await fetch(`${API_URL}/accounts/fee-import/template`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error('Template download failed');
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fee_import_template.xlsx';
  a.click();
};

export const validateFeeImport = async (formData: FormData) => {
  const token = getToken();
  const res = await fetch(`${API_URL}/accounts/fee-import/validate`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Validation failed');
  return data;
};

export const submitFeeBatch = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; message: string; batch: any }>('/accounts/fee-import/submit', input);

export const getFeeBatchDetails = (batchId: string) =>
  apiCall<{ batch: any }>('/accounts/fee-import/batch-detail', { batchId });

export const updateFeeBatchItem = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; item: any }>('/accounts/fee-import/item', input);

export const processFeeBatchApproval = (input: Record<string, unknown>) =>
  apiCall<{ success: boolean; message: string; batch: any }>('/accounts/fee-import/approve', input);

export const executeFeePushBatch = (batchId: string) =>
  apiCall<{ success: boolean; message: string; pushedCount: number }>('/accounts/fee-import/push', { batchId });

export const getAccountsLedger = (input?: { studentId?: string; type?: string } | string) => {
  if (typeof input === 'string') return apiCall<{ entries: any[] }>('/accounts/ledger', { studentId: input });
  return apiCall<{ entries: any[] }>('/accounts/ledger', input || {});
};


// Shop endpoints
export const getShopDashboard = (input: Record<string, unknown> = {}) =>
  apiCall<GetShopDashboardOutputType>('/shop/dashboard', input);

export const generateSalesLedgerReport = (input: { format: 'csv' | 'excel' | 'pdf'; period?: 'today' | 'week' | 'month' | 'all' }) =>
  apiCall<{ url: string }>('/shop/sales-ledger/report', input);

export const regenerateShopQr = (input: Record<string, unknown> = {}) =>
  apiCall<{ success: boolean; qrToken: string; message: string }>('/shop/regenerate-qr', input);

export const updateShopProfile = (input: { description?: string; operatingHours?: string; contactNumber?: string; location?: string; logoUrl?: string }) =>
  apiCall<{ success: boolean; message: string }>('/shop/profile/update', input);

// Merchant first-login onboarding — forced password change, then mandatory email OTP verification.
export const changePassword = (input: { currentPassword?: string; newPassword: string }) =>
  apiCall<{ success: boolean; message: string }>('/auth/change-password', input);

export const sendShopEmailVerificationOtp = () =>
  apiCall<{ success: boolean; message: string; otpId?: string; alreadyVerified?: boolean }>('/auth/shop/send-verification-otp', {});

export const verifyShopEmail = (input: { otpId: string; code: string }) =>
  apiCall<{ success: boolean; message: string }>('/auth/shop/verify-email', input);

// File upload
export const uploadFile = async (file: File | { data: File; filename?: string }): Promise<{ url: string; fileUrl: string }> => {
  const token = getToken();
  const actualFile = file instanceof File ? file : (file as any).data || file;
  const formData = new FormData();
  formData.append('file', actualFile);
  const res = await fetch(`${API_URL}/upload`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Upload failed');
  return { url: data.url, fileUrl: data.url };
};

// Library QR + payment endpoints. The Library QR is a singleton (one shared record/QR for every
// Library Staff account) — unlike Shop, there's no per-staff ownership to scope by.
export type GetLibraryDetailsOutputType = {
  library: {
    id: string; name: string; status: string; qrToken: string; qrSignature?: string;
    location?: string; logoUrl?: string; libraryCode?: string;
    contactNumber?: string; description?: string; operatingHours?: string;
  };
  staff: {
    fullName: string; email: string; phone: string; bio: string; profilePicture: string;
    pinSet: boolean; pinLength: number;
  } | null;
};

export type ValidateLibraryQrOutputType = {
  valid: boolean;
  library: { id: string; name: string; location: string; logoUrl?: string } | null;
  message: string;
};

export const getLibraryDetails = (input: Record<string, unknown> = {}) =>
  apiCall<GetLibraryDetailsOutputType>('/library/details', input);

export const regenerateLibraryQr = (input: Record<string, unknown> = {}) =>
  apiCall<{ success: boolean; qrToken: string; message: string }>('/library/regenerate-qr', input);

export const updateLibraryDetails = (input: { description?: string; operatingHours?: string; contactNumber?: string; location?: string; logoUrl?: string }) =>
  apiCall<{ success: boolean; message: string }>('/library/details/update', input);

export const validateLibraryQr = (input: { qrData: string }) =>
  apiCall<ValidateLibraryQrOutputType>('/library/validate-qr', input);

export const createLibraryQrPayment = (input: { amount: number }) =>
  apiCall<{ success: boolean; fineId: string }>('/library/qr/create-payment', input);

// ─── Settlement Workflow & Accounts Office Endpoints ───

export type SettlementRequestItem = {
  id: string;
  reference: string;
  requestedAmount: number;
  status: 'PendingReview' | 'UnderVerification' | 'Approved' | 'Rejected' | 'ProcessingPayment' | 'Paid' | 'Failed';
  notes: string;
  adminRemarks: string;
  failureReason: string;
  createdAt: string;
  paidAt: string | null;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  bankRoutingNumber?: string;
  adminReviewer?: string | null;
  accountsProcessor?: string | null;
  shop?: { id: string; name: string; category: string; merchantId?: string; logoUrl?: string };
  requestedBy?: { id: string; fullName: string; email: string; phone?: string };
};

export type SettlementTimelineItem = {
  id: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  createdAt: string;
  changedBy: { id: string; fullName: string; email: string; role: string };
};

export type GetShopSettlementsOutputType = {
  requests: SettlementRequestItem[];
  pendingBalance: number;
  statusCounts: Record<string, number>;
};

export type GetAdminSettlementRequestsOutputType = {
  requests: SettlementRequestItem[];
  statusCounts: Record<string, number>;
};

export type GetAccountsProfileOutputType = {
  user: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    department: string;
    role: string;
    employeeId: string;
    designation: string;
    joiningDate: string;
    status: string;
    profilePicture: string;
    bio: string;
    lastLogin: string | null;
    pinSet: boolean;
    pinLength: number;
    mustChangePassword: boolean;
    emailVerified: boolean;
  };
  wallet: {
    id: string;
    walletId: string;
    balance: number;
  };
};

export type GetAccountsWalletOutputType = {
  wallet: {
    id: string;
    walletId: string;
    balance: number;
    dailyTransferLimit: number;
    dailyTransferred: number;
    frozen: boolean;
  };
  recentTransactions: Array<{
    id: string;
    reference: string;
    type: string;
    direction: string;
    amount: number;
    status: string;
    description: string;
    createdAt: string;
  }>;
};

// Shop Settlement APIs
export const createShopSettlementRequest = (input: {
  requestedAmount: number;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  bankRoutingNumber?: string;
  notes?: string;
}) => apiCall<{ success: boolean; message: string; request: SettlementRequestItem }>('/shop/settlement/request', input);

export const getShopSettlements = (input: { status?: string } = {}) =>
  apiCall<GetShopSettlementsOutputType>('/shop/settlement/list', input);

export const getShopSettlementDetail = (input: { requestId: string }) =>
  apiCall<{ request: SettlementRequestItem; timeline: SettlementTimelineItem[] }>('/shop/settlement/detail', input);

export const updateShopBankInfo = (input: {
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  bankRoutingNumber?: string;
}) => apiCall<{ success: boolean; message: string }>('/shop/bank-info/update', input);

// Admin Settlement APIs
export const getAdminSettlementRequests = (input: { status?: string; search?: string } = {}) =>
  apiCall<GetAdminSettlementRequestsOutputType>('/admin/settlement-requests', input);

export const reviewAdminSettlementRequest = (input: {
  requestId: string;
  action: 'under_verification' | 'approve' | 'reject';
  remarks?: string;
}) => apiCall<{ success: boolean; message: string; request: SettlementRequestItem }>('/admin/settlement-requests/review', input);

export const getAdminSettlementDetail = (input: { requestId: string }) =>
  apiCall<{ request: SettlementRequestItem; timeline: SettlementTimelineItem[]; previousSettlements: Array<{ id: string; amount: number; notes: string; settledAt: string }> }>('/admin/settlement-requests/detail', input);

// Accounts Settlement APIs
export const getAccountsSettlements = (input: { status?: string; search?: string } = {}) =>
  apiCall<GetAdminSettlementRequestsOutputType>('/accounts/settlements', input);

export const getAccountsSettlementDetail = (input: { requestId: string }) =>
  apiCall<{ request: SettlementRequestItem; timeline: SettlementTimelineItem[]; previousSettlements: Array<{ id: string; amount: number; notes: string; settledAt: string }> }>('/accounts/settlements/detail', input);

export const processAccountsSettlementOtp = (input: Record<string, unknown> = {}) =>
  apiCall<{ success: boolean; message: string; otpId: string }>('/accounts/settlements/process-otp', input);

export const verifyAccountsSettlementOtp = (input: { otpId: string; code: string }) =>
  apiCall<{ success: boolean; message: string }>('/accounts/settlements/verify-otp', input);

export const executeAccountsSettlementPayment = (input: { requestId: string; otpVerified: boolean; referenceNotes?: string }) =>
  apiCall<{ success: boolean; message: string; request: SettlementRequestItem; paymentReference: string; sslcommerzTranId: string }>('/accounts/settlements/execute-payment', input);

// Accounts Profile & Wallet APIs
export const getAccountsProfile = (input: Record<string, unknown> = {}) =>
  apiCall<GetAccountsProfileOutputType>('/accounts/profile', input);

export const updateAccountsProfile = (input: { fullName?: string; phone?: string; bio?: string; profilePicture?: string; designation?: string; employeeId?: string }) =>
  apiCall<{ success: boolean; message: string }>('/accounts/profile/update', input);

export const getAccountsWallet = (input: Record<string, unknown> = {}) =>
  apiCall<GetAccountsWalletOutputType>('/accounts/wallet', input);

