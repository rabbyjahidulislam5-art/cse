import { useState, useEffect } from 'react';
import { Bell, BellOff, DollarSign } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getShopDashboard, type GetShopDashboardOutputType } from '@/lib/api';
import { motion } from 'framer-motion';

export default function ShopNotificationsPage() {
  const [txns, setTxns] = useState<GetShopDashboardOutputType['recentTransactions']>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getShopDashboard({}).then(d => setTxns(d.recentTransactions)).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl space-y-3"><Skeleton className="h-8 w-48" />{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <h1 className="text-xl font-bold text-foreground mb-6">Payment Alerts</h1>
      {txns.length === 0 ? (
        <div className="text-center py-20"><BellOff className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-sm text-muted-foreground">No payment alerts yet</p></div>
      ) : (
        <div className="space-y-2">
          {txns.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
              className="flex items-center gap-4 p-4 rounded-xl border border-border/60 bg-card">
              <div className="w-10 h-10 rounded-xl bg-[hsl(var(--chart-3))]/10 flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5 text-[hsl(var(--chart-3))]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{t.description || 'Payment received'}</p>
                <p className="text-xs text-muted-foreground font-mono">{t.reference}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-[hsl(var(--chart-3))] tabular">+৳{t.amount.toLocaleString()}</p>
                <span className="text-[10px] text-muted-foreground">{t.status}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
