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
  DISPUTE_STATUSES, type AccountsDisputeSummary, type AdminDisputeStats, type StaffPerformance, type FraudSignals,
} from '@/lib/disputeApi';
import { formatCurrency } from '@/lib/mock-data';

export default function DisputeOversightPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AdminDisputeStats | null>(null);
  const [staff, setStaff] = useState<StaffPerformance[]>([]);
  const [fraud, setFraud] = useState<FraudSignals | null>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [disputes, setDisputes] = useState<AccountsDisputeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  const loadList = (s: string, q: string) => {
    setLoading(true);
    getAdminDisputeList({ status: s === 'all' ? undefined : s, search: q || undefined }).then(res => setDisputes(res.disputes)).finally(() => setLoading(false));
  };
  const debouncedLoad = useDebouncedCallback((q: string) => loadList(status, q), 400);

  useEffect(() => {
    getAdminDisputeStats().then(setStats);
    getStaffPerformance().then(r => setStaff(r.performance));
    getFraudSignals().then(setFraud);
  }, []);
  useEffect(() => { loadList(status, search); }, [status]);

  const handleExport = async (format: 'csv' | 'excel' | 'pdf') => {
    setExporting(format);
    try {
      const { url } = await generateAdminDisputeReport({ format });
      window.open(url, '_blank', 'noopener,noreferrer');
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
          <h1 className="text-xl font-bold text-foreground">Financial Dispute — Case Oversight</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Platform-wide dispute statistics, staff performance, fraud signals</p>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" disabled={!!exporting} onClick={() => handleExport('csv')}>{exporting === 'csv' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'CSV'}</Button>
          <Button variant="outline" size="sm" disabled={!!exporting} onClick={() => handleExport('excel')}>{exporting === 'excel' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Excel'}</Button>
          <Button variant="outline" size="sm" disabled={!!exporting} onClick={() => handleExport('pdf')}>{exporting === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'PDF'}</Button>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Staff performance */}
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Staff Performance</p>
          {staff.length === 0 ? <p className="text-xs text-muted-foreground">No Accounts Office staff found.</p> : (
            <div className="space-y-2">
              {staff.map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30 last:border-0">
                  <span className="font-medium text-foreground">{s.name}</span>
                  <span className="text-muted-foreground">{s.assigned} assigned · {s.resolved} resolved · {s.avgResolutionHours}h avg</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fraud detection */}
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Fraud Detection</p>
          {!fraud ? <Skeleton className="h-20" /> : (
            <div className="space-y-3">
              <div className="flex gap-4 text-xs">
                <span><strong className="text-foreground">{fraud.repeatedFailures}</strong> <span className="text-muted-foreground">rejected cases</span></span>
                <span><strong className="text-foreground">{fraud.fraudCategoryCount}</strong> <span className="text-muted-foreground">fraud-category cases</span></span>
              </div>
              {fraud.repeatedDisputers.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Repeat Disputers (≥3 cases)</p>
                  {fraud.repeatedDisputers.slice(0, 5).map(d => (
                    <div key={d.userId} className="flex items-center justify-between text-xs py-0.5">
                      <span className="flex items-center gap-1">{d.name} {d.flagged && <Flag className="w-3 h-3 text-destructive" />}</span>
                      <span className="text-muted-foreground">{d.disputeCount} cases</span>
                    </div>
                  ))}
                </div>
              )}
              {fraud.repeatedShops.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1"><Store className="w-3 h-3" /> Repeat Shops (≥3 cases)</p>
                  {fraud.repeatedShops.slice(0, 5).map(s => (
                    <div key={s.shopId} className="flex items-center justify-between text-xs py-0.5">
                      <span className="flex items-center gap-1">{s.name} {s.flagged && <Flag className="w-3 h-3 text-destructive" />}</span>
                      <span className="text-muted-foreground">{s.disputeCount} cases</span>
                    </div>
                  ))}
                </div>
              )}
              {fraud.repeatedDisputers.length === 0 && fraud.repeatedShops.length === 0 && (
                <p className="text-xs text-muted-foreground">No repeat-offender patterns detected yet.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search case #, category, student..." value={search}
            onChange={(e) => { setSearch(e.target.value); debouncedLoad(e.target.value); }}
            className="pl-9 bg-accent/50 border-border/60" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-48 bg-accent/50 border-border/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {DISPUTE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
