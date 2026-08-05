import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Bell, QrCode, Loader2, Landmark, Clock, History, BellRing, Wallet2, ScrollText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { getShopDashboard, type GetShopDashboardOutputType } from '@/lib/api';
import { getDisputeBadgeCounts } from '@/lib/disputeApi';
import { useDisputeSocket } from '@/lib/socket';
import { motion } from 'framer-motion';

export default function ShopHomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<GetShopDashboardOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingCases, setPendingCases] = useState(0);

  useEffect(() => {
    getShopDashboard({})
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  // Payments/Disputes moved here from the nav bar's old "More" dropdown — that dropdown's badge
  // was only ever visible once opened, so this tile now carries the same live pending-disputes
  // count (polled + socket-updated) with strictly better at-a-glance visibility.
  useEffect(() => {
    const fetchBadge = () => getDisputeBadgeCounts().then(r => setPendingCases(r.pendingCases)).catch(() => {});
    fetchBadge();
    const interval = setInterval(fetchBadge, 30000);
    return () => clearInterval(interval);
  }, []);
  useDisputeSocket(() => setPendingCases(c => c + 1));

  const quickActions = [
    { label: 'Sales', icon: History, onClick: () => navigate('/shop/ledger'), color: 'from-primary/15 to-primary/5', iconColor: 'text-primary' },
    { label: 'QR Code', icon: QrCode, onClick: () => navigate('/shop/qr'), color: 'from-secondary/15 to-secondary/5', iconColor: 'text-secondary' },
    { label: 'Notification', icon: BellRing, onClick: () => navigate('/shop/notifications'), color: 'from-[hsl(var(--chart-2))]/15 to-[hsl(var(--chart-2))]/5', iconColor: 'text-[hsl(var(--chart-2))]' },
    { label: 'Payments', icon: Wallet2, onClick: () => navigate('/shop/payments'), color: 'from-[hsl(var(--chart-3))]/15 to-[hsl(var(--chart-3))]/5', iconColor: 'text-[hsl(var(--chart-3))]' },
    { label: 'Disputes', icon: ScrollText, onClick: () => navigate('/shop/disputes'), color: 'from-destructive/15 to-destructive/5', iconColor: 'text-destructive', badge: pendingCases },
  ];

  if (loading) return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );

  if (error) return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl text-center py-20">
      <ShoppingBag className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
      <h2 className="text-lg font-bold text-foreground mb-2">Shop Setup Required</h2>
      <p className="text-sm text-muted-foreground mb-6">{error}</p>
      <Button onClick={() => window.location.reload()}>Retry</Button>
    </div>
  );

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-xl font-bold text-foreground">{data?.shop.name || 'Shop Dashboard'}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{data?.shop.category} · {data?.shop.status}</p>
      </motion.div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-6">
        {quickActions.map((qa, i) => (
          <motion.button
            key={qa.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={qa.onClick}
            className="relative flex flex-col items-center justify-center gap-3 p-4 sm:p-5 rounded-2xl border border-border/60 bg-card hover:border-primary/20 transition-all group active:scale-[0.97]"
          >
            {!!qa.badge && qa.badge > 0 && (
              <span className="absolute top-2.5 right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">
                {qa.badge > 99 ? '99+' : qa.badge}
              </span>
            )}
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${qa.color} flex items-center justify-center group-hover:scale-105 transition-transform`}>
              <qa.icon className={`w-5 h-5 ${qa.iconColor}`} />
            </div>
            <span className="text-xs font-semibold text-foreground text-center">{qa.label}</span>
          </motion.button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <motion.button initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={() => navigate('/shop/ledger')}
          className="rounded-2xl border border-border/60 bg-card p-6 text-left hover:border-primary/30 transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-3xl font-bold text-primary-foreground leading-none">৳</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold text-foreground tabular">৳{(data?.totalRevenue || 0).toLocaleString()}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-foreground tabular">{data?.totalCount || 0}</p>
              <p className="text-[10px] text-muted-foreground">transactions</p>
            </div>
          </div>
        </motion.button>

        <motion.button initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          onClick={() => navigate('/shop/qr')}
          className="rounded-2xl border border-border/60 bg-card p-6 text-left hover:border-primary/30 transition-all">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-secondary/80 flex items-center justify-center shadow-lg shadow-secondary/20">
              <QrCode className="w-7 h-7 text-secondary-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Payment QR</p>
              <p className="text-sm font-bold text-foreground">View & Manage</p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{data?.shop.qrToken?.slice(0, 12)}...</p>
            </div>
          </div>
        </motion.button>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-1.5 mb-1"><span className="text-sm font-bold text-muted-foreground leading-none">৳</span><p className="text-xs text-muted-foreground">Total Received</p></div>
          <p className="text-lg font-bold text-foreground tabular">৳{(data?.totalRevenue || 0).toLocaleString()}</p>
        </div>
        <button
          onClick={() => navigate('/shop/settlements')}
          className="rounded-xl border border-border/60 bg-card p-4 text-left hover:border-primary/40 transition-all group"
        >
          <div className="flex items-center justify-between gap-1 mb-1">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[hsl(var(--chart-4))]" />
              <p className="text-xs text-muted-foreground">Pending Settlement</p>
            </div>
            <span className="text-[10px] text-primary font-semibold group-hover:underline">Request →</span>
          </div>
          <p className="text-lg font-bold text-[hsl(var(--chart-4))] tabular">৳{(data?.pendingSettlement || 0).toLocaleString()}</p>
        </button>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-1.5 mb-1"><Landmark className="w-3.5 h-3.5 text-[hsl(var(--chart-3))]" /><p className="text-xs text-muted-foreground">Settled</p></div>
          <p className="text-lg font-bold text-[hsl(var(--chart-3))] tabular">৳{(data?.totalSettled || 0).toLocaleString()}</p>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent Transactions</h2>
          <button onClick={() => navigate('/shop/notifications')} className="text-xs text-primary font-medium">View All →</button>
        </div>
        {!data?.recentTransactions?.length ? (
          <div className="text-center py-12 rounded-2xl border border-border/60 bg-card">
            <ShoppingBag className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No payments yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.recentTransactions.map(t => (
              <div key={t.id} className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card">
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.description || t.type}</p>
                    <p className="text-xs text-muted-foreground font-mono">{t.reference}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-[hsl(var(--chart-3))] tabular">+৳{t.amount.toLocaleString()}</p>
                  <span className={`text-[10px] font-semibold ${t.status === 'Success' ? 'text-[hsl(var(--chart-3))]' : 'text-muted-foreground'}`}>{t.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
