import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Home, QrCode, BellRing, History, LogOut, Store, ScrollText, UserCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { motion } from 'framer-motion';
import { useEffect, useState, useRef } from 'react';
import { getDisputeBadgeCounts } from '@/lib/disputeApi';
import { useDisputeSocket, useNotificationSocket } from '@/lib/socket';
import { getUnreadNotificationCount } from '@/lib/api';
import { MoreMenuDesktop, MoreMenuMobile, type MoreMenuItem } from '@/components/MoreMenu';

const primaryNavItems = [
  { to: '/shop', icon: Home, label: 'Home', end: true },
  { to: '/shop/ledger', icon: History, label: 'Sales' },
  { to: '/shop/qr', icon: QrCode, label: 'QR Code' },
  { to: '/shop/notifications', icon: BellRing, label: 'Alerts' },
];

// A short synthesized beep via the Web Audio API — no external audio asset needed, so there's
// nothing to fail to load. Fires once per realtime dispute notification (new case / reply).
function playAlertSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch { /* audio not available in this environment — non-critical */ }
}

export default function ShopLayout() {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect, logout } = useAuth();
  const [pendingCases, setPendingCases] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!isLoading && !user) loginWithRedirect({ redirectUrl: window.location.href });
  }, [isLoading, user, loginWithRedirect]);

  useEffect(() => {
    if (user && (user as any).role !== 'Shop Staff') navigate('/', { replace: true });
  }, [user, navigate]);

  // Mandatory first-login onboarding — cannot reach the dashboard until both steps complete.
  // These two steps live on standalone routes outside this layout (no nav chrome), so there's no
  // redirect loop to guard against here.
  useEffect(() => {
    if (!user || (user as any).role !== 'Shop Staff') return;
    if (user.mustChangePassword) { navigate('/shop/change-password', { replace: true }); return; }
    if (!user.emailVerified) { navigate('/shop/verify-email', { replace: true }); return; }
  }, [user, navigate]);

  const fetchBadge = () => getDisputeBadgeCounts().then(r => setPendingCases(r.pendingCases)).catch(() => {});
  useEffect(() => {
    if (!user) return;
    fetchBadge();
    mounted.current = true;
    const interval = setInterval(fetchBadge, 30000);
    return () => clearInterval(interval);
  }, [user]);

  useDisputeSocket(() => {
    fetchBadge();
    if (mounted.current) playAlertSound();
  });

  const fetchUnreadNotifs = () => getUnreadNotificationCount().then(r => setUnreadNotifs(r.unreadCount)).catch(() => {});
  useEffect(() => {
    if (!user) return;
    fetchUnreadNotifs();
    const interval = setInterval(fetchUnreadNotifs, 30000);
    return () => clearInterval(interval);
  }, [user]);
  useNotificationSocket(() => setUnreadNotifs(c => c + 1));

  const overflowItems: MoreMenuItem[] = [
    {
      to: '/shop/disputes', icon: ScrollText, label: 'Disputes',
      badge: pendingCases > 0 ? (
        <span className="min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">{pendingCases > 99 ? '99+' : pendingCases}</span>
      ) : undefined,
    },
  ];

  if (isLoading || !user || (user as any).role !== 'Shop Staff') return null;
  if (user.mustChangePassword || !user.emailVerified) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="sticky top-0 z-50 w-full glass-strong">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/shop')} className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-secondary to-secondary/80 flex items-center justify-center shadow-lg shadow-secondary/20">
              <Store className="w-5 h-5 text-secondary-foreground" />
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-foreground text-sm tracking-tight">Shop Panel</span>
              <span className="text-[10px] text-muted-foreground block -mt-0.5">EWU Digital Wallet</span>
            </div>
          </button>

          <div className="hidden md:flex items-center gap-0.5 bg-accent/50 rounded-xl p-1">
            {primaryNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => `relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {({ isActive }) => (
                  <>
                    {isActive && <motion.div layoutId="shop-nav" className="absolute inset-0 gradient-primary rounded-lg shadow-lg shadow-primary/20" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
                    <span className="relative z-10 flex items-center gap-2">
                      <item.icon className="w-4 h-4" /> {item.label}
                      {item.label === 'Alerts' && unreadNotifs > 0 && (
                        <span className="min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">{unreadNotifs > 99 ? '99+' : unreadNotifs}</span>
                      )}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
            <MoreMenuDesktop items={overflowItems} layoutPrefix="shop" />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-9 h-9 rounded-xl bg-gradient-to-br from-secondary/20 to-secondary/10 flex items-center justify-center text-sm font-bold text-secondary hover:from-secondary/30 hover:to-secondary/20 transition-all ring-1 ring-secondary/20">
                {user?.firstName?.charAt(0) || 'S'}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 glass-strong rounded-xl p-1.5">
              <div className="px-3 py-2.5">
                <p className="text-sm font-semibold text-foreground">{user?.fullName || 'Shop Staff'}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{user?.email}</p>
                <p className="text-[10px] text-secondary font-medium mt-1">Shop Staff</p>
              </div>
              <DropdownMenuSeparator className="bg-border/50" />
              <DropdownMenuItem onClick={() => navigate('/shop/profile')} className="rounded-lg">
                <UserCircle className="w-4 h-4 mr-2" /> Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border/50" />
              <DropdownMenuItem onClick={() => logout({ returnTo: window.location.origin })} className="text-destructive focus:text-destructive rounded-lg">
                <LogOut className="w-4 h-4 mr-2" /> Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      <main className="flex-1 pb-20 md:pb-0"><Outlet /></main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong safe-area-bottom">
        <div className="flex items-center justify-around h-[68px] px-1">
          {primaryNavItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => `relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <item.icon className={`w-5 h-5 transition-all ${isActive ? 'scale-110' : ''}`} />
                    {item.label === 'Alerts' && unreadNotifs > 0 && (
                      <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-destructive text-[8px] font-bold text-white flex items-center justify-center">{unreadNotifs > 9 ? '9+' : unreadNotifs}</span>
                    )}
                  </div>
                  <span className="text-[10px] font-semibold">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <MoreMenuMobile items={overflowItems} layoutPrefix="shop-mobile" />
        </div>
      </nav>
    </div>
  );
}
