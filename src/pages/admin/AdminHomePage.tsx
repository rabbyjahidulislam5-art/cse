import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Store, ShieldAlert, Activity, Database, Loader2, CheckCircle2, XCircle, UserCog, UserCircle, ScrollText, FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { getAdminOverview, seedData, type GetAdminOverviewOutputType } from '@/lib/api';
import { getDisputeBadgeCounts } from '@/lib/disputeApi';
import { useDisputeSocket } from '@/lib/socket';
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
  const [pendingCases, setPendingCases] = useState(0);

  // Disputes/Audit moved here from the nav bar's old "More" dropdown — that dropdown's badge was
  // only ever visible once opened, so this tile now carries the same live pending-disputes count
  // (polled + socket-updated) with strictly better at-a-glance visibility.
  useEffect(() => {
    const fetchBadge = () => getDisputeBadgeCounts().then(r => setPendingCases(r.pendingCases)).catch(() => {});
    fetchBadge();
    const interval = setInterval(fetchBadge, 30000);
    return () => clearInterval(interval);
  }, []);
  useDisputeSocket(() => setPendingCases(c => c + 1));

  const quickActions = [
    { label: 'Shops', icon: Store, onClick: () => navigate('/admin/shops'), color: 'from-[hsl(var(--chart-2))]/15 to-[hsl(var(--chart-2))]/5', iconColor: 'text-[hsl(var(--chart-2))]' },
    { label: 'Fines', icon: ShieldAlert, onClick: () => navigate('/admin/fines'), color: 'from-[hsl(var(--chart-5))]/15 to-[hsl(var(--chart-5))]/5', iconColor: 'text-[hsl(var(--chart-5))]' },
    { label: 'Staff', icon: UserCog, onClick: () => navigate('/admin/staff'), color: 'from-[hsl(var(--chart-4))]/15 to-[hsl(var(--chart-4))]/5', iconColor: 'text-[hsl(var(--chart-4))]' },
    { label: 'Profile', icon: UserCircle, onClick: () => navigate('/admin/profile'), color: 'from-primary/15 to-primary/5', iconColor: 'text-primary' },
    { label: 'Disputes', icon: ScrollText, onClick: () => navigate('/admin/disputes'), color: 'from-destructive/15 to-destructive/5', iconColor: 'text-destructive', badge: pendingCases },
    { label: 'Push Records', icon: FileText, onClick: () => navigate('/admin/push-records'), color: 'from-[hsl(var(--chart-4))]/15 to-[hsl(var(--chart-4))]/5', iconColor: 'text-[hsl(var(--chart-4))]' },
    { label: 'Audit', icon: FileText, onClick: () => navigate('/admin/audit'), color: 'from-[hsl(var(--chart-3))]/15 to-[hsl(var(--chart-3))]/5', iconColor: 'text-[hsl(var(--chart-3))]' },
  ];

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
          <StatCard icon={ShieldAlert} label="Fines Awaiting Payment" value={data?.finesPendingCount || 0} color="--chart-5" onClick={() => navigate('/admin/fines')} />
          <StatCard icon={Activity} label="System Status" value="Operational" color="--chart-3" />
        </div>
      </FadeIn>

      <FadeIn delay={0.08}>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-8">
          {quickActions.map((qa, i) => (
            <motion.button
              key={qa.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
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
              <span className="text-xs font-semibold text-foreground">{qa.label}</span>
            </motion.button>
          ))}
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
