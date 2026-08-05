import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookX, Users, AlertTriangle, Loader2, ScrollText, Search, UserCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getLibraryOverview, type GetLibraryOverviewOutputType } from '@/lib/api';
import { getDisputeBadgeCounts } from '@/lib/disputeApi';
import { useDisputeSocket } from '@/lib/socket';
import { motion } from 'framer-motion';

// Disputes/Payment Ledger/Profile moved here from the nav bar's old "More" dropdown — that
// dropdown's collapsed button showed a live pulsing dot for pending disputes, so this tile now
// carries the same live badge (polled + socket-updated) to preserve that at-a-glance visibility.
const quickActionMeta = [
  { label: 'Disputes', to: '/library/disputes', icon: ScrollText, color: 'bg-destructive/10', iconColor: 'text-destructive' },
  { label: 'Payment Ledger', to: '/library/lookup', icon: Search, color: 'bg-primary/10', iconColor: 'text-primary' },
  { label: 'Profile', to: '/library/profile', icon: UserCircle, color: 'bg-[hsl(var(--chart-3))]/10', iconColor: 'text-[hsl(var(--chart-3))]' },
];

export default function LibraryHomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<GetLibraryOverviewOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCases, setPendingCases] = useState(0);

  useEffect(() => { getLibraryOverview({}).then(setData).finally(() => setLoading(false)); }, []);

  useEffect(() => {
    const fetchBadge = () => getDisputeBadgeCounts().then(r => setPendingCases(r.pendingCases)).catch(() => {});
    fetchBadge();
    const interval = setInterval(fetchBadge, 30000);
    return () => clearInterval(interval);
  }, []);
  useDisputeSocket(() => setPendingCases(c => c + 1));

  if (loading) return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[1,2].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <motion.button initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          onClick={() => navigate('/library/fines/assign')}
          className="rounded-2xl border border-border/60 bg-card p-6 text-left hover:border-primary/30 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
              <BookX className="w-6 h-6 text-destructive" />
            </div>
            <span className="text-3xl font-bold text-foreground tabular">{data?.totalFinesOutstanding || 0}</span>
          </div>
          <p className="text-sm font-semibold text-foreground">Fines Outstanding</p>
          <p className="text-xs text-muted-foreground mt-0.5">Total: ৳{(data?.fineAmount || 0).toLocaleString()}</p>
        </motion.button>

        <motion.button initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          onClick={() => navigate('/library/clearance')}
          className="rounded-2xl border border-border/60 bg-card p-6 text-left hover:border-primary/30 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-[hsl(var(--chart-4))]/10 flex items-center justify-center">
              <Users className="w-6 h-6 text-[hsl(var(--chart-4))]" />
            </div>
            <span className="text-3xl font-bold text-foreground tabular">{data?.studentsPendingClearance || 0}</span>
          </div>
          <p className="text-sm font-semibold text-foreground">Pending Clearance</p>
          <p className="text-xs text-muted-foreground mt-0.5">Students with unpaid fines</p>
        </motion.button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {quickActionMeta.map((qa, i) => (
          <motion.button
            key={qa.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.06 }}
            onClick={() => navigate(qa.to)}
            className="relative flex flex-col items-center justify-center gap-3 p-4 sm:p-5 rounded-2xl border border-border/60 bg-card hover:border-primary/20 transition-all group active:scale-[0.97]"
          >
            {qa.label === 'Disputes' && pendingCases > 0 && (
              <span className="absolute top-2.5 right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">
                {pendingCases > 99 ? '99+' : pendingCases}
              </span>
            )}
            <div className={`w-11 h-11 rounded-xl ${qa.color} flex items-center justify-center group-hover:scale-105 transition-transform`}>
              <qa.icon className={`w-5 h-5 ${qa.iconColor}`} />
            </div>
            <span className="text-xs font-semibold text-foreground">{qa.label}</span>
          </motion.button>
        ))}
      </div>

      {data?.recentFines && data.recentFines.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent Fines</h2>
          <div className="space-y-2">
            {data.recentFines.map(f => (
              <div key={f.id} className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{f.label}</p>
                    <p className="text-xs text-muted-foreground">{f.studentName}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-foreground tabular">৳{f.amount.toLocaleString()}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${f.status === 'Pending' ? 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))]' : f.status === 'Paid' ? 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]' : 'bg-muted text-muted-foreground'}`}>{f.status}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
