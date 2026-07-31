import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { GraduationCap, Home, Store, FileWarning, ScanLine, LogOut, Settings, ScrollText, CreditCard, History, UserCircle, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { UserProvider, useUser } from '@/lib/user-context';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { motion } from 'framer-motion';
import { getDisputeBadgeCounts } from '@/lib/disputeApi';
import { useDisputeSocket } from '@/lib/socket';
import NotificationBell from '@/components/NotificationBell';
import { MoreMenuDesktop, MoreMenuMobile, type MoreMenuItem } from '@/components/MoreMenu';
import { getFinancialStatus, type FinancialStatusOutputType } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';

// Unified Outstanding Due Settlement — routes a financially restricted student can still reach.
// Everything else redirects to /student/dues, where the consolidated settlement lives.
const RESTRICTION_ALLOWED_PREFIXES = ['/student/dues', '/student/profile', '/student/settings'];

const primaryNavItems = [
  { to: '/student', icon: Home, label: 'Home', end: true },
  { to: '/student/shops', icon: Store, label: 'Shops' },
  { to: '/student/scan', icon: ScanLine, label: 'Scan' },
  { to: '/student/dues', icon: FileWarning, label: 'Dues' },
];

function LayoutInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useUser();
  const { logout } = useAuth();
  const [pendingCases, setPendingCases] = useState(0);
  const [financialStatus, setFinancialStatus] = useState<FinancialStatusOutputType | null>(null);

  useEffect(() => {
    if (!user) return;
    const fetchBadge = () => getDisputeBadgeCounts().then(r => setPendingCases(r.pendingCases)).catch(() => {});
    fetchBadge();
    // Poll as a fallback (socket disconnects, tab was backgrounded, etc.) — the socket below is
    // what makes the badge update instantly in the common case.
    const interval = setInterval(fetchBadge, 30000);
    return () => clearInterval(interval);
  }, [user]);

  useDisputeSocket(() => setPendingCases(c => c + 1));

  // Financial restriction is derived live server-side, never cached on the login-time user
  // object — a Semester Fee can go overdue, or get cleared by a settlement, at any point during
  // a long-lived session. Polled the same way the dispute badge above is, so it self-heals
  // shortly after either happens without requiring a re-login.
  useEffect(() => {
    if (!user) return;
    const fetchStatus = () => getFinancialStatus().then(setFinancialStatus).catch(() => {});
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const restricted = !!financialStatus?.restricted;
  useEffect(() => {
    if (!restricted) return;
    const onAllowedRoute = RESTRICTION_ALLOWED_PREFIXES.some(p => location.pathname.startsWith(p));
    if (!onAllowedRoute) navigate('/student/dues', { replace: true });
  }, [restricted, location.pathname, navigate]);

  const overflowItems: MoreMenuItem[] = [
    { to: '/student/payments', icon: CreditCard, label: 'Payments' },
    { to: '/student/ledger', icon: History, label: 'Ledger' },
    {
      to: '/student/disputes', icon: ScrollText, label: 'Disputes',
      badge: pendingCases > 0 ? (
        <span className="min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">{pendingCases > 99 ? '99+' : pendingCases}</span>
      ) : undefined,
    },
    { to: '/student/profile', icon: UserCircle, label: 'Profile' },
    { to: '/student/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Nav */}
      <nav className="sticky top-0 z-50 w-full glass-strong">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/student')} className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20 group-hover:shadow-primary/30 transition-shadow">
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-foreground text-sm tracking-tight">Smart Campus</span>
              <span className="text-[10px] text-muted-foreground block -mt-0.5">EWU Campus Wallet</span>
            </div>
          </button>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5 bg-accent/50 rounded-xl p-1">
            {primaryNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => `relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="nav-indicator"
                        className="absolute inset-0 gradient-primary rounded-lg shadow-lg shadow-primary/20"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
            <MoreMenuDesktop items={overflowItems} layoutPrefix="student" />
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <NotificationBell to="/student/notifications" />

            {loading ? <Skeleton className="w-9 h-9 rounded-xl" /> : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center text-sm font-bold text-primary hover:from-primary/30 hover:to-primary/20 transition-all ring-1 ring-primary/20">
                    {user?.fullName?.charAt(0) || '?'}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 glass-strong rounded-xl p-1.5">
                  <div className="px-3 py-2.5">
                    <p className="text-sm font-semibold text-foreground">{user?.fullName || 'Student'}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{user?.email}</p>
                    {user?.studentId && (
                      <p className="text-[10px] text-primary font-mono mt-1">{user.studentId}</p>
                    )}
                  </div>
                  <DropdownMenuSeparator className="bg-border/50" />
                  <DropdownMenuItem onClick={() => navigate('/student/profile')} className="rounded-lg">
                    <UserCircle className="w-4 h-4 mr-2" /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/student/settings')} className="rounded-lg">
                    <Settings className="w-4 h-4 mr-2" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border/50" />
                  <DropdownMenuItem onClick={() => logout({ returnTo: window.location.origin })} className="text-destructive focus:text-destructive rounded-lg">
                    <LogOut className="w-4 h-4 mr-2" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </nav>

      {/* Financial restriction notice — persistent, not dismissible; clears itself the moment
          the overdue Semester Fee is settled (online or via Accounts Office's offline recording). */}
      {restricted && (
        <div className="w-full bg-destructive/10 border-b border-destructive/20">
          <div className="container mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2.5 text-xs sm:text-sm text-destructive">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="font-medium">
              Account financially restricted — outstanding balance {formatCurrency(financialStatus?.totalOutstanding || 0)}. Settle your dues below to restore full access.
            </span>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong safe-area-bottom">
        <div className="flex items-center justify-around h-[68px] px-1">
          {primaryNavItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => `relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {({ isActive }) => (
                <>
                  <item.icon className={`w-5 h-5 transition-all ${isActive ? 'scale-110' : ''}`} />
                  <span className="text-[10px] font-semibold">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <MoreMenuMobile items={overflowItems} layoutPrefix="student-mobile" />
        </div>
      </nav>
    </div>
  );
}

export default function StudentLayout() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const wrongRole = !isLoading && !!user && !!user.role && user.role !== 'Student';

  // Guard at this outer level, before UserProvider ever mounts — UserProvider fetches the
  // student dashboard unconditionally on mount, so a staff account landing on /student (e.g. a
  // stale bookmark or manual URL edit) would otherwise briefly fetch and render with its own
  // (non-student) account data before the redirect below takes effect.
  useEffect(() => {
    if (wrongRole) navigate('/', { replace: true });
  }, [wrongRole, navigate]);

  if (wrongRole) return null;

  return (
    <UserProvider>
      <LayoutInner />
    </UserProvider>
  );
}
