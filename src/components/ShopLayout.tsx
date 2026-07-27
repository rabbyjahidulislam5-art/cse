import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, QrCode, BellRing, History, LogOut, Store } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { motion } from 'framer-motion';
import { useEffect } from 'react';

const navItems = [
  { to: '/shop', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/shop/qr', icon: QrCode, label: 'QR Code' },
  { to: '/shop/notifications', icon: BellRing, label: 'Alerts' },
  { to: '/shop/ledger', icon: History, label: 'Sales' },
];

export default function ShopLayout() {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect, logout } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) loginWithRedirect({ redirectUrl: window.location.href });
  }, [isLoading, user, loginWithRedirect]);

  useEffect(() => {
    if (user && (user as any).role !== 'Shop Staff') navigate('/', { replace: true });
  }, [user, navigate]);

  if (isLoading || !user) return null;

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
              <span className="text-[10px] text-muted-foreground block -mt-0.5">Smart Campus</span>
            </div>
          </button>

          <div className="hidden md:flex items-center gap-0.5 bg-accent/50 rounded-xl p-1">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => `relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {({ isActive }) => (
                  <>
                    {isActive && <motion.div layoutId="shop-nav" className="absolute inset-0 gradient-primary rounded-lg shadow-lg shadow-primary/20" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
                    <span className="relative z-10 flex items-center gap-2"><item.icon className="w-4 h-4" /> {item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
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
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => `relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.div layoutId="shop-mobile" className="absolute -top-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full gradient-primary" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
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
