import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Home, Store, ShieldAlert, UserCog, LogOut, Shield, UserCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import NotificationBell from '@/components/NotificationBell';

// Exactly 5 primary tabs, matching the Student/Library nav pattern — Disputes/Audit (formerly a
// "More" dropdown) now live as icon tiles on the Home dashboard instead, matching the Scan & Pay
// / Add Money tile style used elsewhere.
const primaryNavItems = [
  { to: '/admin', icon: Home, label: 'Home', end: true },
  { to: '/admin/shops', icon: Store, label: 'Shops' },
  { to: '/admin/fines', icon: ShieldAlert, label: 'Fines' },
  { to: '/admin/staff', icon: UserCog, label: 'Staff' },
  { to: '/admin/profile', icon: UserCircle, label: 'Profile' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect, logout } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) loginWithRedirect({ redirectUrl: window.location.href });
  }, [isLoading, user, loginWithRedirect]);

  useEffect(() => {
    if (user && user.role !== 'Admin Office') navigate('/', { replace: true });
  }, [user, navigate]);

  if (isLoading || !user || user.role !== 'Admin Office') return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="sticky top-0 z-50 w-full glass-strong">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/admin')} className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-destructive/80 to-destructive flex items-center justify-center shadow-lg shadow-destructive/20">
              <Shield className="w-5 h-5 text-destructive-foreground" />
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-foreground text-sm tracking-tight">Admin Office</span>
              <span className="text-[10px] text-muted-foreground block -mt-0.5">EWU Digital Wallet</span>
            </div>
          </button>

          <div className="hidden md:flex items-center gap-0.5 bg-accent/50 rounded-xl p-1">
            {primaryNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => `relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div layoutId="admin-nav" className="absolute inset-0 gradient-primary rounded-lg shadow-lg shadow-primary/20" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
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
            <NotificationBell to="/admin/notifications" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-9 h-9 rounded-xl bg-gradient-to-br from-destructive/20 to-destructive/10 flex items-center justify-center text-sm font-bold text-destructive hover:from-destructive/30 hover:to-destructive/20 transition-all ring-1 ring-destructive/20">
                  {user?.firstName?.charAt(0) || 'A'}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12} className="w-56 glass-strong rounded-xl p-1.5">
                <div className="px-3 py-2.5">
                  <p className="text-sm font-semibold text-foreground">{user?.fullName || 'Admin'}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{user?.email}</p>
                  <p className="text-[10px] text-destructive font-medium mt-1">Admin Office</p>
                </div>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem onClick={() => logout({ returnTo: window.location.origin })} className="text-destructive focus:text-destructive rounded-lg">
                  <LogOut className="w-4 h-4 mr-2" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

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
        </div>
      </nav>
    </div>
  );
}
