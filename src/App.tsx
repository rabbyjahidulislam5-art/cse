import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth-context';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

function OptionalGoogleOAuthProvider({ children }: { children: React.ReactNode }) {
  if (!GOOGLE_CLIENT_ID) return <>{children}</>;
  return <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{children}</GoogleOAuthProvider>;
}
import LandingPage from './pages/LandingPage';
import StudentLayout from './components/StudentLayout';
import AdminLayout from './components/AdminLayout';
import LibraryLayout from './components/LibraryLayout';
import AccountsLayout from './components/AccountsLayout';
import ShopLayout from './components/ShopLayout';

// Student pages
import HomePage from './pages/student/HomePage';
import ShopsPage from './pages/student/ShopsPage';
import ShopDetailPage from './pages/student/ShopDetailPage';
import DuesPage from './pages/student/DuesPage';
import LedgerPage from './pages/student/LedgerPage';
import ProfilePage from './pages/student/ProfilePage';
import QrScannerPage from './pages/student/QrScannerPage';
import TransferPage from './pages/student/TransferPage';
import PaymentResultPage from './pages/student/PaymentResultPage';
import NotificationsPage from './pages/student/NotificationsPage';
import ReceiptPage from './pages/student/ReceiptPage';
import WithdrawPage from './pages/student/WithdrawPage';

// Admin pages
import AdminHomePage from './pages/admin/AdminHomePage';
import ShopManagementPage from './pages/admin/ShopManagementPage';
import FinesPage from './pages/admin/FinesPage';
import AuditLogsPage from './pages/admin/AuditLogsPage';
import StaffAccountsPage from './pages/admin/StaffAccountsPage';

// Library pages
import LibraryHomePage from './pages/library/LibraryHomePage';
import StudentLookupPage from './pages/library/StudentLookupPage';
import FineImpositionPage from './pages/library/FineImpositionPage';
import FineWaiverPage from './pages/library/FineWaiverPage';
import ClearanceStatusPage from './pages/library/ClearanceStatusPage';

// Accounts pages
import AccountsHomePage from './pages/accounts/AccountsHomePage';
import SemesterFeePushPage from './pages/accounts/SemesterFeePushPage';
import FeeAdjustmentsPage from './pages/accounts/FeeAdjustmentsPage';
import CollectionAnalyticsPage from './pages/accounts/CollectionAnalyticsPage';
import WithdrawalsPage from './pages/accounts/WithdrawalsPage';

// Shop pages
import ShopHomePage from './pages/shop/ShopHomePage';
import ShopQrPage from './pages/shop/ShopQrPage';
import ShopNotificationsPage from './pages/shop/ShopNotificationsPage';
import ShopSalesLedgerPage from './pages/shop/ShopSalesLedgerPage';

export default function App() {
  return (
    <OptionalGoogleOAuthProvider>
    <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        
        {/* Student Dashboard */}
        <Route path="/student" element={<StudentLayout />}>
          <Route index element={<HomePage />} />
          <Route path="shops" element={<ShopsPage />} />
          <Route path="shops/:shopId" element={<ShopDetailPage />} />
          <Route path="dues" element={<DuesPage />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="scan" element={<QrScannerPage />} />
          <Route path="transfer" element={<TransferPage />} />
          <Route path="payment-result" element={<PaymentResultPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="receipt" element={<ReceiptPage />} />
          <Route path="withdraw" element={<WithdrawPage />} />
        </Route>

        {/* Admin Office Dashboard */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminHomePage />} />
          <Route path="shops" element={<ShopManagementPage />} />
          <Route path="fines" element={<FinesPage />} />
          <Route path="audit" element={<AuditLogsPage />} />
          <Route path="staff" element={<StaffAccountsPage />} />
        </Route>

        {/* Library Dashboard */}
        <Route path="/library" element={<LibraryLayout />}>
          <Route index element={<LibraryHomePage />} />
          <Route path="lookup" element={<StudentLookupPage />} />
          <Route path="fines/assign" element={<FineImpositionPage />} />
          <Route path="fines/waive" element={<FineWaiverPage />} />
          <Route path="clearance" element={<ClearanceStatusPage />} />
        </Route>

        {/* Accounts Office Dashboard */}
        <Route path="/accounts" element={<AccountsLayout />}>
          <Route index element={<AccountsHomePage />} />
          <Route path="fee-push" element={<SemesterFeePushPage />} />
          <Route path="adjustments" element={<FeeAdjustmentsPage />} />
          <Route path="analytics" element={<CollectionAnalyticsPage />} />
          <Route path="withdrawals" element={<WithdrawalsPage />} />
        </Route>

        {/* Shop Dashboard */}
        <Route path="/shop" element={<ShopLayout />}>
          <Route index element={<ShopHomePage />} />
          <Route path="qr" element={<ShopQrPage />} />
          <Route path="notifications" element={<ShopNotificationsPage />} />
          <Route path="ledger" element={<ShopSalesLedgerPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
    </AuthProvider>
    </OptionalGoogleOAuthProvider>
  );
}
