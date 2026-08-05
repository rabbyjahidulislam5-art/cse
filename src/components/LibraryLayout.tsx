import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, BookX, QrCode, Bell, UserCircle, LogOut, BookOpen,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import NotificationBell from '@/components/NotificationBell';

// Exactly 5 primary tabs — Disputes/Payment Ledger/Profile (formerly a "More" dropdown) now live
// as icon tiles on the Home dashboard instead, matching the student dashboard's tile style.
// Profile remains additionally reachable from anywhere via the avatar menu below.
const desktopNavItems = [
  { to: '/library', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/library/fines/assign', icon: BookX, label: 'Penalty Fee' },
  { to: '/library/qr', icon: QrCode, label: 'QR Code' },
  { to: '/library/notifications', icon: Bell, label: 'Notification' },
  { to: '/library/profile', icon: UserCircle, label: 'Profile' },
];

export default function LibraryLayout() {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect, logout } = useAuth();

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

  if (isLoading || !user || (user as any).role !== 'Library') return null;
  if (user.mustChangePassword || !user.emailVerified) return null;

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

          {/* Desktop Navigation: Home → Penalty Fee → QR Code → Notification → Profile */}
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

      {/* Mobile Bottom Navigation (5 items: Home, Penalty Fee, QR Code, Notification, Profile) */}
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
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>Penalty Fee</span>
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
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>Notification</span>
              </>
            )}
          </NavLink>

          <NavLink
            to="/library/profile"
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <UserCircle className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>Profile</span>
              </>
            )}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
