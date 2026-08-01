import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ScrollText, ChevronRight, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StatusBadge from '@/components/StatusBadge';
import { FadeIn } from '@/components/PageTransition';
import { getMyDisputes, type DisputeSummary, type DisputeStatus } from '@/lib/disputeApi';
import { formatCurrency } from '@/lib/mock-data';
import { useUser } from '@/lib/user-context';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All Cases' },
  { value: 'Open', label: 'Open' },
  { value: 'Investigating', label: 'Investigating' },
  { value: 'WaitingForStudent', label: 'Waiting For You' },
  { value: 'Resolved', label: 'Resolved' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Refunded', label: 'Refunded' },
  { value: 'Closed', label: 'Closed' },
];

function slaLabel(slaDueAt: string | null, status: DisputeStatus) {
  if (!slaDueAt || ['Resolved', 'Rejected', 'Refunded', 'Closed'].includes(status)) return null;
  const diffMs = new Date(slaDueAt).getTime() - Date.now();
  if (diffMs <= 0) return { text: 'SLA overdue', overdue: true };
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  return { text: hours < 24 ? `${hours}h left` : `${Math.round(hours / 24)}d left`, overdue: false };
}

export default function DisputesPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [disputes, setDisputes] = useState<DisputeSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getMyDisputes({ status: status === 'all' ? undefined : status })
      .then(res => setDisputes(res.disputes))
      .finally(() => setLoading(false));
  }, [user, status]);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <FadeIn>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Financial Disputes</h1>

          </div>
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-56 bg-accent/50 border-border/60 mb-6"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FadeIn>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
          <ScrollText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">No disputes found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Raise one from any completed payment in your Ledger</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {disputes.map((d, i) => {
            const sla = slaLabel(d.slaDueAt, d.status);
            return (
              <motion.button
                key={d.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => navigate(`/student/disputes/detail?disputeId=${d.id}`)}
                className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/60 bg-card hover:border-destructive/30 transition-all text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold text-destructive">{d.caseNumber}</span>
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="text-sm font-semibold text-foreground truncate">{d.category}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    {d.transaction && <span>{d.transaction.type} · {formatCurrency(d.transaction.amount)}</span>}
                    {sla && (
                      <span className={`flex items-center gap-1 ${sla.overdue ? 'text-destructive' : ''}`}>
                        <Clock className="w-3 h-3" /> {sla.text}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
