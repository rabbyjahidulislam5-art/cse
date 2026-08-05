import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { RefreshCw } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth-context';

// Always non-empty in a correctly configured build — see src/lib/google-auth-config.ts for
// the runtime check that surfaces a real error dialog when it isn't.
const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';

import LandingPage from './pages/LandingPage';
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));

// Each dashboard's layout + pages are lazy-loaded so a user only ever downloads the
// bundle for the one role they're logged in as, instead of all 5 dashboards at once.
const StudentLayout = lazy(() => import('./components/StudentLayout'));
const AdminLayout = lazy(() => import('./components/AdminLayout'));
const LibraryLayout = lazy(() => import('./components/LibraryLayout'));
const AccountsLayout = lazy(() => import('./components/AccountsLayout'));
const ShopLayout = lazy(() => import('./components/ShopLayout'));

// Student pages
const HomePage = lazy(() => import('./pages/student/HomePage'));
const ShopsPage = lazy(() => import('./pages/student/ShopsPage'));
const ShopDetailPage = lazy(() => import('./pages/student/ShopDetailPage'));
const DuesPage = lazy(() => import('./pages/student/DuesPage'));
const LedgerPage = lazy(() => import('./pages/student/LedgerPage'));
const ProfilePage = lazy(() => import('./pages/student/ProfilePage'));
const SettingsPage = lazy(() => import('./pages/student/SettingsPage'));
const QrScannerPage = lazy(() => import('./pages/student/QrScannerPage'));
const TransferPage = lazy(() => import('./pages/student/TransferPage'));
const WithdrawPage = lazy(() => import('./pages/student/WithdrawPage'));
const PaymentResultPage = lazy(() => import('./pages/student/PaymentResultPage'));
const NotificationsPage = lazy(() => import('./pages/student/NotificationsPage'));
const ReceiptPage = lazy(() => import('./pages/student/ReceiptPage'));
const PaymentsDashboardPage = lazy(() => import('./pages/student/PaymentsDashboardPage'));
const DisputesPage = lazy(() => import('./pages/student/DisputesPage'));
const DisputeDetailPage = lazy(() => import('./pages/student/DisputeDetailPage'));

// Admin pages
const AdminHomePage = lazy(() => import('./pages/admin/AdminHomePage'));
const ShopManagementPage = lazy(() => import('./pages/admin/ShopManagementPage'));
const FinesPage = lazy(() => import('./pages/admin/FinesPage'));
const AuditLogsPage = lazy(() => import('./pages/admin/AuditLogsPage'));
const StaffAccountsPage = lazy(() => import('./pages/admin/StaffAccountsPage'));
const DisputeOversightPage = lazy(() => import('./pages/admin/DisputeOversightPage'));
const AdminDisputeDetailPage = lazy(() => import('./pages/admin/AdminDisputeDetailPage'));
const AdminNotificationsPage = lazy(() => import('./pages/admin/AdminNotificationsPage'));
const AdminProfilePage = lazy(() => import('./pages/admin/AdminProfilePage'));

// Library pages
const LibraryHomePage = lazy(() => import('./pages/library/LibraryHomePage'));
const StudentLookupPage = lazy(() => import('./pages/library/StudentLookupPage'));
const FineImpositionPage = lazy(() => import('./pages/library/FineImpositionPage'));
const FineWaiverPage = lazy(() => import('./pages/library/FineWaiverPage'));
const ClearanceStatusPage = lazy(() => import('./pages/library/ClearanceStatusPage'));
const LibraryDisputesPage = lazy(() => import('./pages/library/LibraryDisputesPage'));
const LibraryDisputeDetailPage = lazy(() => import('./pages/library/LibraryDisputeDetailPage'));
const LibraryNotificationsPage = lazy(() => import('./pages/library/LibraryNotificationsPage'));
const LibraryQrPage = lazy(() => import('./pages/library/LibraryQrPage'));
const LibraryProfilePage = lazy(() => import('./pages/library/LibraryProfilePage'));
const LibraryChangeTempPasswordPage = lazy(() => import('./pages/library/LibraryChangeTempPasswordPage'));
const LibraryVerifyEmailPage = lazy(() => import('./pages/library/LibraryVerifyEmailPage'));

// Accounts pages
const AccountsHomePage = lazy(() => import('./pages/accounts/AccountsHomePage'));
const SemesterFeePushPage = lazy(() => import('./pages/accounts/SemesterFeePushPage'));
const FeeWizardPage = lazy(() => import('./pages/accounts/FeeWizardPage'));
const FeeAdjustmentsPage = lazy(() => import('./pages/accounts/FeeAdjustmentsPage'));
const CollectionAnalyticsPage = lazy(() => import('./pages/accounts/CollectionAnalyticsPage'));
const AccountsLedgerPage = lazy(() => import('./pages/accounts/LedgerPage'));
const DisputesDashboardPage = lazy(() => import('./pages/accounts/DisputesDashboardPage'));
const DisputeCaseDetailPage = lazy(() => import('./pages/accounts/DisputeCaseDetailPage'));
const DisputeReportsPage = lazy(() => import('./pages/accounts/DisputeReportsPage'));
const AccountsNotificationsPage = lazy(() => import('./pages/accounts/AccountsNotificationsPage'));
const AdministrativeFinesPage = lazy(() => import('./pages/accounts/AdministrativeFinesPage'));
const LibraryFinesPage = lazy(() => import('./pages/accounts/LibraryFinesPage'));
const StudentFinancialProfilePage = lazy(() => import('./pages/accounts/StudentFinancialProfilePage'));
const ScholarshipPushPage = lazy(() => import('./pages/accounts/ScholarshipPushPage'));
const AccountsQrPage = lazy(() => import('./pages/accounts/AccountsQrPage'));
const ManualBankPaymentPage = lazy(() => import('./pages/accounts/ManualBankPaymentPage'));
const AccountsChangeTempPasswordPage = lazy(() => import('./pages/accounts/AccountsChangeTempPasswordPage'));
const AccountsVerifyEmailPage = lazy(() => import('./pages/accounts/AccountsVerifyEmailPage'));
const AccountsProfilePage = lazy(() => import('./pages/accounts/AccountsProfilePage'));
const AccountsWalletPage = lazy(() => import('./pages/accounts/AccountsWalletPage'));
const SettlementProcessingPage = lazy(() => import('./pages/accounts/SettlementProcessingPage'));
const PushRecordsPage = lazy(() => import('./pages/accounts/PushRecordsPage'));

// Shop pages
const ShopHomePage = lazy(() => import('./pages/shop/ShopHomePage'));
const ShopQrPage = lazy(() => import('./pages/shop/ShopQrPage'));
const ShopNotificationsPage = lazy(() => import('./pages/shop/ShopNotificationsPage'));
const ShopSalesLedgerPage = lazy(() => import('./pages/shop/ShopSalesLedgerPage'));
const ShopPaymentsPage = lazy(() => import('./pages/shop/ShopPaymentsPage'));
const ShopDisputesPage = lazy(() => import('./pages/shop/ShopDisputesPage'));
const ShopDisputeDetailPage = lazy(() => import('./pages/shop/ShopDisputeDetailPage'));
const ShopChangeTempPasswordPage = lazy(() => import('./pages/shop/ShopChangeTempPasswordPage'));
const ShopVerifyEmailPage = lazy(() => import('./pages/shop/ShopVerifyEmailPage'));
const ShopProfilePage = lazy(() => import('./pages/shop/ShopProfilePage'));
const ShopSettlementsPage = lazy(() => import('./pages/shop/ShopSettlementsPage'));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <RefreshCw className="w-6 h-6 text-primary animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID} locale="en">
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />

              {/* Student Dashboard */}
              <Route path="/student" element={<StudentLayout />}>
                <Route index element={<HomePage />} />
                <Route path="shops" element={<ShopsPage />} />
                <Route path="shops/:shopId" element={<ShopDetailPage />} />
                <Route path="dues" element={<DuesPage />} />
                <Route path="ledger" element={<LedgerPage />} />
                <Route path="payments" element={<PaymentsDashboardPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="scan" element={<QrScannerPage />} />
                <Route path="transfer" element={<TransferPage />} />
                <Route path="withdraw" element={<WithdrawPage />} />
                <Route path="payment-result" element={<PaymentResultPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="receipt" element={<ReceiptPage />} />
                <Route path="disputes" element={<DisputesPage />} />
                <Route path="disputes/detail" element={<DisputeDetailPage />} />
              </Route>

              {/* Admin Office Dashboard */}
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminHomePage />} />
                <Route path="shops" element={<ShopManagementPage />} />
                <Route path="fines" element={<FinesPage />} />
                <Route path="audit" element={<AuditLogsPage />} />
                <Route path="staff" element={<StaffAccountsPage />} />
                <Route path="disputes" element={<DisputeOversightPage />} />
                <Route path="disputes/detail" element={<AdminDisputeDetailPage />} />
                <Route path="notifications" element={<AdminNotificationsPage />} />
                <Route path="profile" element={<AdminProfilePage />} />
                <Route path="push-records" element={<PushRecordsPage />} />
              </Route>

              {/* Library first-login onboarding — standalone, outside LibraryLayout (no nav chrome, mandatory) */}
              <Route path="/library/change-password" element={<LibraryChangeTempPasswordPage />} />
              <Route path="/library/verify-email" element={<LibraryVerifyEmailPage />} />

              {/* Library Dashboard */}
              <Route path="/library" element={<LibraryLayout />}>
                <Route index element={<LibraryHomePage />} />
                <Route path="lookup" element={<StudentLookupPage />} />
                <Route path="fines/assign" element={<FineImpositionPage />} />
                <Route path="fines/waive" element={<FineWaiverPage />} />
                <Route path="clearance" element={<ClearanceStatusPage />} />
                <Route path="disputes" element={<LibraryDisputesPage />} />
                <Route path="disputes/detail" element={<LibraryDisputeDetailPage />} />
                <Route path="notifications" element={<LibraryNotificationsPage />} />
                <Route path="qr" element={<LibraryQrPage />} />
                <Route path="profile" element={<LibraryProfilePage />} />
              </Route>

              {/* Accounts first-login onboarding — standalone, outside AccountsLayout (no nav chrome, mandatory) */}
              <Route path="/accounts/change-password" element={<AccountsChangeTempPasswordPage />} />
              <Route path="/accounts/verify-email" element={<AccountsVerifyEmailPage />} />

              {/* Accounts Office Dashboard */}
              <Route path="/accounts" element={<AccountsLayout />}>
                <Route index element={<AccountsHomePage />} />
                <Route path="settlements" element={<SettlementProcessingPage />} />
                <Route path="fee-push" element={<SemesterFeePushPage />} />
                <Route path="fee-wizard" element={<FeeWizardPage />} />
                <Route path="ledger" element={<AccountsLedgerPage />} />
                <Route path="adjustments" element={<FeeAdjustmentsPage />} />
                <Route path="analytics" element={<CollectionAnalyticsPage />} />
                <Route path="disputes" element={<DisputesDashboardPage />} />
                <Route path="disputes/detail" element={<DisputeCaseDetailPage />} />
                <Route path="disputes/reports" element={<DisputeReportsPage />} />
                <Route path="notifications" element={<AccountsNotificationsPage />} />
                <Route path="admin-fines" element={<AdministrativeFinesPage />} />
                <Route path="library-fines" element={<LibraryFinesPage />} />
                <Route path="student-profile" element={<StudentFinancialProfilePage />} />
                <Route path="scholarship-push" element={<ScholarshipPushPage />} />
                <Route path="push-records" element={<PushRecordsPage />} />
                <Route path="qr" element={<AccountsQrPage />} />
                <Route path="manual-payment" element={<ManualBankPaymentPage />} />
                <Route path="profile" element={<AccountsProfilePage />} />
                <Route path="wallet" element={<AccountsWalletPage />} />
              </Route>

              {/* Shop first-login onboarding — standalone, outside ShopLayout (no nav chrome, mandatory) */}
              <Route path="/shop/change-password" element={<ShopChangeTempPasswordPage />} />
              <Route path="/shop/verify-email" element={<ShopVerifyEmailPage />} />

              {/* Shop Dashboard */}
              <Route path="/shop" element={<ShopLayout />}>
                <Route index element={<ShopHomePage />} />
                <Route path="settlements" element={<ShopSettlementsPage />} />
                <Route path="qr" element={<ShopQrPage />} />
                <Route path="notifications" element={<ShopNotificationsPage />} />
                <Route path="ledger" element={<ShopSalesLedgerPage />} />
                <Route path="payments" element={<ShopPaymentsPage />} />
                <Route path="disputes" element={<ShopDisputesPage />} />
                <Route path="disputes/detail" element={<ShopDisputeDetailPage />} />
                <Route path="profile" element={<ShopProfilePage />} />
              </Route>

              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
