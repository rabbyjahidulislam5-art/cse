import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, ShoppingBag, Bell, QrCode, Loader2, Landmark, Clock, Wallet } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { getShopDashboard, type GetShopDashboardOutputType } from '@/lib/api';
import { motion } from 'framer-motion';

export default function ShopHomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<GetShopDashboardOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getShopDashboard({})
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <motion.button initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={() => navigate('/shop/ledger')}
          className="rounded-2xl border border-border/60 bg-card p-6 text-left hover:border-primary/30 transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20">
                <DollarSign className="w-7 h-7 text-primary-foreground" />
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

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-1.5 mb-1"><Wallet className="w-3.5 h-3.5 text-primary" /><p className="text-xs text-muted-foreground">Wallet Balance</p></div>
          <p className="text-lg font-bold text-primary tabular">৳{(data?.wallet?.balance || 0).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-1.5 mb-1"><DollarSign className="w-3.5 h-3.5 text-muted-foreground" /><p className="text-xs text-muted-foreground">Total Received</p></div>
          <p className="text-lg font-bold text-foreground tabular">৳{(data?.totalRevenue || 0).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-1.5 mb-1"><Clock className="w-3.5 h-3.5 text-[hsl(var(--chart-4))]" /><p className="text-xs text-muted-foreground">Pending Settlement</p></div>
          <p className="text-lg font-bold text-[hsl(var(--chart-4))] tabular">৳{(data?.pendingSettlement || 0).toLocaleString()}</p>
        </div>
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
