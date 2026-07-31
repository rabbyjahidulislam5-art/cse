import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, BookX, QrCode, Bell, ScrollText, Search, UserCircle, LogOut,
  BookOpen, ChevronDown, MoreHorizontal, X, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { getDisputeBadgeCounts } from '@/lib/disputeApi';
import { useDisputeSocket } from '@/lib/socket';
import NotificationBell from '@/components/NotificationBell';

const desktopNavItems = [
  { to: '/library', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/library/fines/assign', icon: BookX, label: 'Sales' },
  { to: '/library/qr', icon: QrCode, label: 'QR Code' },
  { to: '/library/notifications', icon: Bell, label: 'Alerts' },
];

export default function LibraryLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading, loginWithRedirect, logout } = useAuth();
  const [pendingCases, setPendingCases] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) loginWithRedirect({ redirectUrl: window.location.href });
  }, [isLoading, user, loginWithRedirect]);

  useEffect(() => {
    if (user && (user as any).role !== 'Library') navigate('/', { replace: true });
  }, [user, navigate]);

  // Mandatory first-login onboarding check
  useEffect(() => {
    if (!user || (user as any).role !== 'Library') return;
    if (user.mustChangePassword) { navigate('/library/change-password', { replace: true }); return; }
    if (!user.emailVerified) { navigate('/library/verify-email', { replace: true }); return; }
  }, [user, navigate]);

  const fetchBadge = () => getDisputeBadgeCounts().then(r => setPendingCases(r.pendingCases)).catch(() => {});
  useEffect(() => {
    if (!user) return;
    fetchBadge();
    const interval = setInterval(fetchBadge, 30000);
    return () => clearInterval(interval);
  }, [user]);
  useDisputeSocket(() => fetchBadge());

  if (isLoading || !user || (user as any).role !== 'Library') return null;
  if (user.mustChangePassword || !user.emailVerified) return null;

  const isMoreDropdownActive = ['/library/disputes', '/library/lookup', '/library/profile'].some(path =>
    location.pathname.startsWith(path)
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header Top Nav */}
      <nav className="sticky top-0 z-50 w-full glass-strong">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/library')} className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[hsl(var(--chart-3))] to-[hsl(var(--chart-3))]/80 flex items-center justify-center shadow-lg shadow-[hsl(var(--chart-3))]/20">
              <BookOpen className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-foreground text-sm tracking-tight">Library</span>
              <span className="text-[10px] text-muted-foreground block -mt-0.5">EWU Digital Wallet</span>
            </div>
          </button>

          {/* Desktop Navigation: Home → Sales → QR Code → Alerts → More */}
          <div className="hidden md:flex items-center gap-0.5 bg-accent/50 rounded-xl p-1">
            {desktopNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="lib-nav"
                        className="absolute inset-0 gradient-primary rounded-lg shadow-lg shadow-primary/20"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <item.icon className="w-4 h-4" /> {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}

            {/* Desktop More Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isMoreDropdownActive
                      ? 'text-primary-foreground bg-primary/90 shadow-md shadow-primary/20'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <MoreHorizontal className="w-4 h-4" />
                  <span>More</span>
                  {pendingCases > 0 && (
                    <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                  )}
                  <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 glass-strong rounded-xl p-1.5 space-y-0.5">
                <DropdownMenuItem onClick={() => navigate('/library/disputes')} className="rounded-lg flex items-center justify-between cursor-pointer">
                  <span className="flex items-center gap-2">
                    <ScrollText className="w-4 h-4 text-muted-foreground" /> Disputes
                  </span>
                  {pendingCases > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">
                      {pendingCases > 99 ? '99+' : pendingCases}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/library/lookup')} className="rounded-lg cursor-pointer">
                  <Search className="w-4 h-4 mr-2 text-muted-foreground" /> Payment Ledger
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/library/profile')} className="rounded-lg cursor-pointer">
                  <UserCircle className="w-4 h-4 mr-2 text-muted-foreground" /> Profile
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell to="/library/notifications" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-9 h-9 rounded-xl bg-gradient-to-br from-[hsl(var(--chart-3))]/20 to-[hsl(var(--chart-3))]/10 flex items-center justify-center text-sm font-bold text-[hsl(var(--chart-3))] hover:from-[hsl(var(--chart-3))]/30 hover:to-[hsl(var(--chart-3))]/20 transition-all ring-1 ring-[hsl(var(--chart-3))]/20">
                  {user?.firstName?.charAt(0) || 'L'}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-strong rounded-xl p-1.5">
                <div className="px-3 py-2.5">
                  <p className="text-sm font-semibold text-foreground">{user?.fullName || 'Librarian'}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{user?.email}</p>
                  <p className="text-[10px] text-[hsl(var(--chart-3))] font-medium mt-1">Library Staff</p>
                </div>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem onClick={() => navigate('/library/qr')} className="rounded-lg cursor-pointer">
                  <QrCode className="w-4 h-4 mr-2" /> Payment QR Code
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/library/profile')} className="rounded-lg cursor-pointer">
                  <UserCircle className="w-4 h-4 mr-2" /> Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem onClick={() => logout({ returnTo: window.location.origin })} className="text-destructive focus:text-destructive rounded-lg cursor-pointer">
                  <LogOut className="w-4 h-4 mr-2" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      <main className="flex-1 pb-20 md:pb-0"><Outlet /></main>

      {/* Mobile Bottom Navigation (5 items: Home, Sales, QR Code, Alerts, More) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass-strong safe-area-bottom border-t border-border/40">
        <div className="flex items-center justify-around h-[68px] px-1">
          <NavLink
            to="/library"
            end
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <LayoutDashboard className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>Home</span>
              </>
            )}
          </NavLink>

          <NavLink
            to="/library/fines/assign"
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <BookX className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>Sales</span>
              </>
            )}
          </NavLink>

          <NavLink
            to="/library/qr"
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <QrCode className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>QR Code</span>
              </>
            )}
          </NavLink>

          <NavLink
            to="/library/notifications"
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Bell className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>Alerts</span>
              </>
            )}
          </NavLink>

          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl transition-colors ${
              moreOpen || isMoreDropdownActive ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <div className="relative">
              <MoreHorizontal className={`w-5 h-5 transition-transform ${moreOpen || isMoreDropdownActive ? 'scale-110' : ''}`} />
              {pendingCases > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-destructive animate-pulse" />
              )}
            </div>
            <span className={`text-[10px] ${moreOpen || isMoreDropdownActive ? 'font-bold' : 'font-medium'}`}>More</span>
          </button>
        </div>
      </nav>

      {/* Mobile Bottom Sheet (Animated bottom-up) */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 glass-strong rounded-t-3xl p-5 border-t border-border/60 pb-8 safe-area-bottom shadow-2xl space-y-3"
            >
              <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30 mx-auto mb-1" />
              
              <div className="flex items-center justify-between px-1 mb-2">
                <h3 className="text-sm font-bold text-foreground">More Options</h3>
                <button
                  onClick={() => setMoreOpen(false)}
                  className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2">
                {/* Payment Ledger */}
                <button
                  onClick={() => { setMoreOpen(false); navigate('/library/lookup'); }}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-border/50 bg-card hover:bg-accent/40 active:scale-[0.99] text-left transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <Search className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Payment Ledger</p>
                      <p className="text-xs text-muted-foreground">Student fine lookup & payment records</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>

                {/* Disputes */}
                <button
                  onClick={() => { setMoreOpen(false); navigate('/library/disputes'); }}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-border/50 bg-card hover:bg-accent/40 active:scale-[0.99] text-left transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center text-destructive">
                      <ScrollText className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">Disputes</p>
                        {pendingCases > 0 && (
                          <span className="min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">
                            {pendingCases > 99 ? '99+' : pendingCases}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Review student fine disputes</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>

                {/* Profile */}
                <button
                  onClick={() => { setMoreOpen(false); navigate('/library/profile'); }}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-border/50 bg-card hover:bg-accent/40 active:scale-[0.99] text-left transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[hsl(var(--chart-3))]/10 flex items-center justify-center text-[hsl(var(--chart-3))]">
                      <UserCircle className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Profile</p>
                      <p className="text-xs text-muted-foreground">Library account settings & info</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
