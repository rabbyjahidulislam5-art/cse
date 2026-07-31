import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookX, Users, AlertTriangle, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getLibraryOverview, type GetLibraryOverviewOutputType } from '@/lib/api';
import { motion } from 'framer-motion';

export default function LibraryHomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<GetLibraryOverviewOutputType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getLibraryOverview({}).then(setData).finally(() => setLoading(false)); }, []);

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
