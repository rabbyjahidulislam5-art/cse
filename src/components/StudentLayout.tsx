import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { GraduationCap, Home, Store, FileWarning, History, UserCircle, Bell, ScanLine, LogOut, Settings, ScrollText, CreditCard } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { UserProvider, useUser } from '@/lib/user-context';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { motion } from 'framer-motion';
import { getDisputeBadgeCounts } from '@/lib/disputeApi';
import { useDisputeSocket } from '@/lib/socket';

const navItems = [
  { to: '/student', icon: Home, label: 'Home', end: true },
  { to: '/student/scan', icon: ScanLine, label: 'Scan' },
  { to: '/student/shops', icon: Store, label: 'Shops' },
  { to: '/student/dues', icon: FileWarning, label: 'Dues' },
  { to: '/student/payments', icon: CreditCard, label: 'Payments' },
  { to: '/student/ledger', icon: History, label: 'Ledger' },
  { to: '/student/disputes', icon: ScrollText, label: 'Disputes' },
];

function LayoutInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useUser();
  const { logout } = useAuth();
  const [unreadReplies, setUnreadReplies] = useState(0);

  useEffect(() => {
    if (!user) return;
    const fetchBadge = () => getDisputeBadgeCounts().then(r => setUnreadReplies(r.unreadReplies)).catch(() => {});
    fetchBadge();
    // Poll as a fallback (socket disconnects, tab was backgrounded, etc.) — the socket below is
    // what makes the badge update instantly in the common case.
    const interval = setInterval(fetchBadge, 30000);
    return () => clearInterval(interval);
  }, [user]);

  useDisputeSocket(() => setUnreadReplies(c => c + 1));

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
              <span className="text-[10px] text-muted-foreground block -mt-0.5">Digital Wallet</span>
            </div>
          </button>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5 bg-accent/50 rounded-xl p-1">
            {navItems.map((item) => (
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
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/student/disputes')}
              className="relative p-2.5 rounded-xl hover:bg-accent/80 transition-all duration-200 group"
            >
              <Bell className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
              {unreadReplies > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center ring-2 ring-background">
                  {unreadReplies > 9 ? '9+' : unreadReplies}
                </span>
              ) : (
                <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full ring-2 ring-background" />
              )}
            </button>

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
                  <DropdownMenuItem onClick={() => navigate('/student/profile')} className="rounded-lg">
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

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong safe-area-bottom">
        <div className="flex items-center justify-around h-[68px] px-1">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => `relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.div
                      layoutId="mobile-nav"
                      className="absolute -top-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full gradient-primary"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <item.icon className={`w-5 h-5 transition-all ${isActive ? 'scale-110' : ''}`} />
                  <span className="text-[10px] font-semibold">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <NavLink to="/student/profile"
            className={({ isActive }) => `relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.div
                    layoutId="mobile-nav"
                    className="absolute -top-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full gradient-primary"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <UserCircle className={`w-5 h-5 transition-all ${isActive ? 'scale-110' : ''}`} />
                <span className="text-[10px] font-semibold">Profile</span>
              </>
            )}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}

export default function StudentLayout() {
  return (
    <UserProvider>
      <LayoutInner />
    </UserProvider>
  );
}
