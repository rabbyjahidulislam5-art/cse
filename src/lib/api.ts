const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function getToken(): string | null {
  return localStorage.getItem('auth_token');
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
  };
};

export type GetDuesOutputType = {
  semester: DueItem[]; library: DueItem[]; admin: DueItem[]; payLater: DueItem[];
};
type DueItem = { id: string; source: string; label: string; amount: number; status: string; dueDate: string };

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
  activeFines?: number; totalFineAmount?: number;
  recentFines?: Array<any>;
  recentActivity: Array<{
    id: string; action: string; actor: string; entityType: string; details: string; createdAt: string;
  }>;
};

export type GetAdminShopsOutputType = {
  shops: Array<{
    id: string; name: string; category: string; rating: number;
    status: string; location: string; logoUrl: string; merchantId: string; qrToken: string;
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
    qrSignature?: string;
  };
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
  apiCall<{ url: string; [key: string]: any }>('/receipt', input);

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

export const withdrawFromWallet = (input: { amount: number; mobileNumber: string; provider?: string }) =>
  apiCall<{ success: boolean; newBalance: number; transactionId: string; reference: string; message: string }>('/wallet/withdraw', input);

export type SemesterFeeLookupOutputType = {
  found: boolean;
  student?: { fullName: string; studentId: string; department: string; batch: string };
  totalDue: number;
  feeCount: number;
  fees: Array<{ id: string; label: string; amount: number; dueDate: string }>;
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
};

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
  apiCall<{ success: boolean; message: string; shopId?: string }>('/admin/shops/manage', input);

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

// Shop endpoints
export const getShopDashboard = (input: Record<string, unknown> = {}) =>
  apiCall<GetShopDashboardOutputType>('/shop/dashboard', input);

export const generateSalesLedgerReport = (input: { format: 'csv' | 'excel' | 'pdf'; period?: 'today' | 'week' | 'month' | 'all' }) =>
  apiCall<{ url: string }>('/shop/sales-ledger/report', input);

export const regenerateShopQr = (input: Record<string, unknown> = {}) =>
  apiCall<{ success: boolean; qrToken: string; message: string }>('/shop/regenerate-qr', input);

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
