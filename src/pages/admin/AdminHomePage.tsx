import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Store, ShieldAlert, Activity, Database, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { getAdminOverview, seedData, type GetAdminOverviewOutputType } from '@/lib/api';
import { toast } from 'sonner';
import { FadeIn } from '@/components/PageTransition';

type OverviewData = GetAdminOverviewOutputType;

function StatCard({ icon: Icon, label, value, subtitle, color, onClick }: {
  icon: typeof Store; label: string; value: string | number; subtitle?: string; color: string; onClick?: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 text-left transition-all hover:border-primary/20 group w-full`}
    >
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.04] blur-2xl" style={{ background: `hsl(var(${color}))` }} />
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3`} style={{ background: `hsl(var(${color}) / 0.1)` }}>
        <Icon className="w-5 h-5" style={{ color: `hsl(var(${color}))` }} />
      </div>
      <p className="text-2xl font-bold text-foreground tabular">{value}</p>
      <p className="text-xs text-muted-foreground font-medium mt-0.5">{label}</p>
      {subtitle && <p className="text-[10px] text-muted-foreground/70 mt-1">{subtitle}</p>}
    </motion.button>
  );
}

export default function AdminHomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await seedData({});
      if (res.success) { toast.success(res.message); loadData(); }
      else toast.info(res.message);
    } catch (e: any) { toast.error(e.message || 'Seed failed'); }
    finally { setSeeding(false); }
  };

  const loadData = () => {
    getAdminOverview({})
      .then(setData)
      .catch(() => toast.error('Failed to load overview'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      {data && data.totalShops === 0 && (
        <FadeIn>
          <Button onClick={handleSeed} disabled={seeding} variant="outline" size="sm" className="mb-4">
            {seeding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
            {seeding ? 'Seeding...' : 'Seed Demo Data'}
          </Button>
        </FadeIn>
      )}

      <FadeIn delay={0.05}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={Store} label="Total Shops" value={data?.totalShops || 0} subtitle={`${data?.activeShops || 0} active · ${data?.suspendedShops || 0} suspended`} color="--chart-2" onClick={() => navigate('/admin/shops')} />
          <StatCard icon={ShieldAlert} label="Fines Awaiting Payment" value={data?.finesPendingCount || 0} subtitle="Monitoring only — Accounts Office collects payment" color="--chart-5" onClick={() => navigate('/admin/fines')} />
          <StatCard icon={Activity} label="System Status" value="Operational" color="--chart-3" />
        </div>
      </FadeIn>

      {/* Fines Issued — status monitoring only. Admin Office issues fines but is never the
          payment receiver; this deliberately shows counts, never an amount framed as owed to
          Admin. The financial/receivable view lives in Accounts Office's Administrative Fines
          section instead. */}
      <FadeIn delay={0.1}>
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="p-5 border-b border-border/40 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Fines Issued — Status Monitor</h2>
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/fines')}>Manage Fines</Button>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border/30">
            <div className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground tabular">{data?.finesPendingCount || 0}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1"><ShieldAlert className="w-3.5 h-3.5" style={{ color: 'hsl(var(--chart-5))' }} /> Pending</p>
            </div>
            <div className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground tabular">{data?.finesPaidCount || 0}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'hsl(var(--chart-3))' }} /> Paid to Accounts Office</p>
            </div>
            <div className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground tabular">{data?.finesCancelledCount || 0}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1"><XCircle className="w-3.5 h-3.5" style={{ color: 'hsl(var(--muted-foreground))' }} /> Cancelled</p>
            </div>
          </div>
        </div>
      </FadeIn>
    </div>
  );
}
