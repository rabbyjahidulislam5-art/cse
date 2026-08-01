import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, ChevronRight, FileBarChart, ShieldAlert, Users, Store, Flag, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import { useDebouncedCallback } from 'use-debounce';
import { toast } from 'sonner';
import {
  getAdminDisputeStats, getAdminDisputeList, getStaffPerformance, getFraudSignals, generateAdminDisputeReport,
  type AccountsDisputeSummary, type AdminDisputeStats, type StaffPerformance, type FraudSignals,
} from '@/lib/disputeApi';
import { formatCurrency } from '@/lib/mock-data';
import { triggerDownload } from '@/lib/download';

export default function DisputeOversightPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AdminDisputeStats | null>(null);
  const [staff, setStaff] = useState<StaffPerformance[]>([]);
  const [fraud, setFraud] = useState<FraudSignals | null>(null);
  const [scope, setScope] = useState<'active' | 'completed'>('active');
  const [ownership, setOwnership] = useState<'all' | 'mine'>('all');
  const [search, setSearch] = useState('');
  const [disputes, setDisputes] = useState<AccountsDisputeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  const loadList = (sc: 'active' | 'completed', own: 'all' | 'mine', q: string) => {
    setLoading(true);
    getAdminDisputeList({ scope: sc, mineOnly: own === 'mine', search: q || undefined }).then(res => setDisputes(res.disputes)).finally(() => setLoading(false));
  };
  const debouncedLoad = useDebouncedCallback((q: string) => loadList(scope, ownership, q), 400);

  useEffect(() => {
    getAdminDisputeStats().then(setStats);
    getStaffPerformance().then(r => setStaff(r.performance));
    getFraudSignals().then(setFraud);
  }, []);
  useEffect(() => { loadList(scope, ownership, search); }, [scope, ownership]);

  const handleExport = async (format: 'csv' | 'excel' | 'pdf') => {
    setExporting(format);
    try {
      const { url } = await generateAdminDisputeReport({ format });
      triggerDownload(url);
    } catch (e: any) {
      toast.error(e.message || 'Export failed.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Audit dispute</h1>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" disabled={!!exporting} onClick={() => handleExport('csv')}>{exporting === 'csv' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'CSV'}</Button>
          <Button variant="outline" size="sm" disabled={!!exporting} onClick={() => handleExport('excel')}>{exporting === 'excel' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Excel'}</Button>

        </div>
      </div>

      {!stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="p-4 rounded-xl border border-border/60 bg-card text-center">
            <p className="text-xl font-bold text-foreground tabular">{stats.total}</p>
            <p className="text-[10px] text-muted-foreground">Total Cases</p>
          </div>
          <div className="p-4 rounded-xl border border-border/60 bg-card text-center">
            <p className="text-xl font-bold text-destructive tabular">{stats.escalations}</p>
            <p className="text-[10px] text-muted-foreground">Escalations</p>
          </div>
          <div className="p-4 rounded-xl border border-border/60 bg-card text-center">
            <p className={`text-xl font-bold tabular ${stats.pendingSla > 0 ? 'text-destructive' : 'text-foreground'}`}>{stats.pendingSla}</p>
            <p className="text-[10px] text-muted-foreground">SLA Overdue</p>
          </div>
          <div className="p-4 rounded-xl border border-border/60 bg-card text-center">
            <p className={`text-xl font-bold tabular ${stats.pendingApprovals > 0 ? 'text-[hsl(var(--chart-4))]' : 'text-foreground'}`}>{stats.pendingApprovals}</p>
            <p className="text-[10px] text-muted-foreground">Refunds Awaiting Approval</p>
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
        <Select value={scope} onValueChange={v => setScope(v as 'active' | 'completed')}>
          <SelectTrigger className="w-full sm:w-44 bg-accent/50 border-border/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active Cases</SelectItem>
            <SelectItem value="completed">Completed Cases</SelectItem>
          </SelectContent>
        </Select>
        <Select value={ownership} onValueChange={v => setOwnership(v as 'all' | 'mine')}>
          <SelectTrigger className="w-full sm:w-40 bg-accent/50 border-border/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cases</SelectItem>
            <SelectItem value="mine">My Cases</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-card/50"><p className="text-sm text-muted-foreground">No cases match this filter</p></div>
      ) : (
        <div className="flex flex-col gap-2">
          {disputes.map((d, i) => (
            <motion.button key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
              onClick={() => navigate(`/admin/disputes/detail?disputeId=${d.id}`)}
              className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/60 bg-card hover:border-primary/30 transition-all text-left">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs font-bold text-primary">{d.caseNumber}</span>
                  <StatusBadge status={d.status} />
                  {d.priority === 'High' && <span className="text-[9px] font-bold uppercase text-destructive">High Priority</span>}
                </div>
                <div className="text-sm font-semibold text-foreground truncate">{d.studentName} <span className="text-muted-foreground font-normal">({d.studentId})</span></div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{d.category} {d.transaction && `· ${formatCurrency(d.transaction.amount)}`} {d.assignedToName && `· ${d.assignedToName}`}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
