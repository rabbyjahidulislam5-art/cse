import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, ChevronRight, Clock, RefreshCw, FileBarChart, Snowflake } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import { useDebouncedCallback } from 'use-debounce';
import { getAccountsDisputeStats, getAccountsDisputeList, type AccountsDisputeSummary, type AccountsDisputeStats, type DisputeStatus } from '@/lib/disputeApi';
import { formatCurrency } from '@/lib/mock-data';
import BackButton from '@/components/BackButton';

const KANBAN_STATUSES: DisputeStatus[] = ['Open', 'Investigating', 'WaitingForStudent', 'WaitingForShop', 'WaitingForLibrary', 'WaitingForAdmin', 'Resolved', 'Rejected', 'Refunded'];

function slaLabel(slaDueAt: string | null, status: DisputeStatus, frozen: boolean) {
  if (!slaDueAt || frozen || ['Resolved', 'Rejected', 'Refunded', 'Closed'].includes(status)) return null;
  const diffMs = new Date(slaDueAt).getTime() - Date.now();
  if (diffMs <= 0) return { text: 'Overdue', overdue: true };
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  return { text: hours < 24 ? `${hours}h left` : `${Math.round(hours / 24)}d left`, overdue: false };
}

export default function DisputesDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AccountsDisputeStats | null>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [disputes, setDisputes] = useState<AccountsDisputeSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = (s: string, q: string, mine: boolean) => {
    setLoading(true);
    getAccountsDisputeList({ status: s === 'all' ? undefined : s, search: q || undefined, assignedToMe: mine || undefined })
      .then(res => setDisputes(res.disputes))
      .finally(() => setLoading(false));
  };

  const debouncedLoad = useDebouncedCallback((q: string) => load(status, q, assignedToMe), 400);

  useEffect(() => { getAccountsDisputeStats().then(setStats); }, []);
  useEffect(() => { load(status, search, assignedToMe); }, [status, assignedToMe]);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      <BackButton fallback="/accounts" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Financial Disputes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Case management dashboard</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/accounts/disputes/reports')}>
          <FileBarChart className="w-4 h-4" /> Reports
        </Button>
      </div>

      {/* Kanban status counts */}
      {!stats ? (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 mb-6">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 mb-6">
          {KANBAN_STATUSES.map((s, i) => (
            <motion.button key={s} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              onClick={() => setStatus(s)}
              className={`p-3 rounded-xl border text-left transition-all ${status === s ? 'border-primary bg-primary/10' : 'border-border/60 bg-card hover:border-primary/30'}`}>
              <div className="text-lg font-bold text-foreground tabular">{stats.byStatus[s] ?? 0}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{s.replace(/([A-Z])/g, ' $1').trim()}</div>
            </motion.button>
          ))}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-3 gap-2.5 mb-6">
          <div className="p-3.5 rounded-xl border border-border/60 bg-card text-center">
            <p className="text-lg font-bold text-foreground tabular">{stats.avgResolutionHours}h</p>
            <p className="text-[10px] text-muted-foreground">Avg Resolution</p>
          </div>
          <div className="p-3.5 rounded-xl border border-border/60 bg-card text-center">
            <p className={`text-lg font-bold tabular ${stats.slaOverdue > 0 ? 'text-destructive' : 'text-foreground'}`}>{stats.slaOverdue}</p>
            <p className="text-[10px] text-muted-foreground">SLA Overdue</p>
          </div>
          <div className="p-3.5 rounded-xl border border-border/60 bg-card text-center">
            <p className="text-lg font-bold text-foreground tabular">{formatCurrency(stats.totalRefunded)}</p>
            <p className="text-[10px] text-muted-foreground">Total Refunded ({stats.refundCount})</p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input aria-label="Search case number, category, or student" placeholder="Search case #, category, student..." value={search}
            onChange={(e) => { setSearch(e.target.value); debouncedLoad(e.target.value); }}
            className="pl-9 bg-accent/50 border-border/60" />
        </div>


        <Button variant="outline" size="icon" onClick={() => load(status, search, assignedToMe)}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-card/50">
          <p className="text-sm font-medium text-muted-foreground">No cases match this filter</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {disputes.map((d, i) => {
            const sla = slaLabel(d.slaDueAt, d.status, d.frozen);
            return (
              <motion.button key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                onClick={() => navigate(`/accounts/disputes/detail?disputeId=${d.id}`)}
                className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/60 bg-card hover:border-primary/30 transition-all text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-xs font-bold text-primary">{d.caseNumber}</span>
                    <StatusBadge status={d.status} />
                    {d.priority === 'High' && <span className="text-[9px] font-bold uppercase text-destructive">High Priority</span>}
                    {d.frozen && <Snowflake className="w-3 h-3 text-secondary" />}
                  </div>
                  <div className="text-sm font-semibold text-foreground truncate">{d.studentName} <span className="text-muted-foreground font-normal">({d.studentId})</span></div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{d.category}</span>
                    {d.transaction && <span>· {formatCurrency(d.transaction.amount)}</span>}
                    {d.assignedToName && <span>· {d.assignedToName}</span>}
                    {sla && <span className={`flex items-center gap-1 ${sla.overdue ? 'text-destructive' : ''}`}><Clock className="w-3 h-3" /> {sla.text}</span>}
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
