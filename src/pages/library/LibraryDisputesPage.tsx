import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ScrollText, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { FadeIn } from '@/components/PageTransition';
import BackButton from '@/components/BackButton';
import { getLibraryDisputeList, type RoleDisputeSummary } from '@/lib/disputeApi';
import { formatCurrency } from '@/lib/mock-data';

export default function LibraryDisputesPage() {
  const navigate = useNavigate();
  const [disputes, setDisputes] = useState<RoleDisputeSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getLibraryDisputeList({}).then(res => setDisputes(res.disputes)).finally(() => setLoading(false)); }, []);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <FadeIn>
        <BackButton fallback="/library" />
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Library Dispute Inbox</h1>

        </div>
      </FadeIn>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
          <ScrollText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">No cases waiting for Library review</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {disputes.map((d, i) => (
            <motion.button key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => navigate(`/library/disputes/detail?disputeId=${d.id}`)}
              className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/60 bg-card hover:border-[hsl(var(--chart-3))]/40 transition-all text-left">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1"><span className="font-mono text-xs font-bold text-[hsl(var(--chart-3))]">{d.caseNumber}</span><StatusBadge status={d.status} /></div>
                <div className="text-sm font-semibold text-foreground truncate">{d.studentName} <span className="text-muted-foreground font-normal">({d.studentId})</span></div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{d.category}{d.transaction && ` · ${formatCurrency(d.transaction.amount)}`}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
