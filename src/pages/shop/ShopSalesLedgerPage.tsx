import { useState, useEffect } from 'react';
import { History } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getShopDashboard, generateSalesLedgerReport, type GetShopDashboardOutputType } from '@/lib/api';
import { motion } from 'framer-motion';
import ExportButton from '@/components/ExportButton';
import BackButton from '@/components/BackButton';

export default function ShopSalesLedgerPage() {
  const [data, setData] = useState<GetShopDashboardOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');

  useEffect(() => { getShopDashboard({}).then(setData).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-24 rounded-2xl" />{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const periodStart = period === 'today' ? new Date().setHours(0, 0, 0, 0) : period === 'week' ? now - 7 * dayMs : new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const txns = (data?.recentTransactions || []).filter(t => new Date(t.createdAt || 0).getTime() >= periodStart);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <BackButton fallback="/shop" />
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground">Sales Ledger</h1>
        <ExportButton
          supportRoute="/shop/disputes"
          onExport={(format) => generateSalesLedgerReport({ format, period })}
        />
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Total Revenue</p>
            <p className="text-3xl font-bold text-foreground tabular mt-1">৳{(data?.totalRevenue || 0).toLocaleString()}</p>
          </div>
          <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
            <span className="text-2xl font-bold text-primary-foreground leading-none">৳</span>
          </div>
        </div>
      </div>

      <div className="flex gap-1 bg-accent/50 rounded-xl p-1 mb-6">
        {(['today', 'week', 'month'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${period === p ? 'gradient-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground'}`}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {txns.length === 0 ? (
        <div className="text-center py-16"><History className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-sm text-muted-foreground">No sales recorded</p></div>
      ) : (
        <div className="space-y-2">
          {txns.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card">
              <div>
                <p className="text-sm font-medium text-foreground">{t.description || t.type}</p>
                <p className="text-xs text-muted-foreground font-mono">{t.reference}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-[hsl(var(--chart-3))] tabular">৳{t.amount.toLocaleString()}</p>
                <span className={`text-[10px] font-semibold ${t.status === 'Success' ? 'text-[hsl(var(--chart-3))]' : 'text-muted-foreground'}`}>{t.status}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
