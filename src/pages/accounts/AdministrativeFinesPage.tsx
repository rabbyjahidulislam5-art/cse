import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, ShieldAlert, CheckCircle2, XCircle, Clock, Loader2, X, BadgeCheck, User, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import {
  listAccountsAdminFines, getAccountsAdminFineDetail, reconcileAdminFine,
  type AdminFineRow, type ListAccountsAdminFinesOutputType, type AccountsAdminFineDetailOutputType,
} from '@/lib/api';
import { useNotificationSocket } from '@/lib/socket';
import { FadeIn } from '@/components/PageTransition';
import BackButton from '@/components/BackButton';

const STATUS_TABS = ['All', 'Pending', 'Paid', 'Waived', 'Cancelled', 'Disputed'];

function StatChip({ icon: Icon, label, value, color }: { icon: typeof ShieldAlert; label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `hsl(var(${color}) / 0.1)` }}>
        <Icon className="w-5 h-5" style={{ color: `hsl(var(${color}))` }} />
      </div>
      <div>
        <p className="text-xl font-bold text-foreground tabular">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function AdministrativeFinesPage() {
  const [data, setData] = useState<ListAccountsAdminFinesOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [detail, setDetail] = useState<AccountsAdminFineDetailOutputType | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listAccountsAdminFines({ status: status === 'All' ? undefined : status, search: search || undefined, page, pageSize: 20 })
      .then(setData)
      .catch(() => toast.error('Failed to load administrative fines'))
      .finally(() => setLoading(false));
  }, [status, search, page]);

  useEffect(() => { load(); }, [load]);

  // A fine payment lands live via notifyRole('Accounts Office', ...) in confirmSslPayment — refetch
  // so this section reflects it immediately, matching every other synced module in the app.
  useNotificationSocket((n) => { if (n.category === 'payment') load(); });

  const openDetail = async (fine: AdminFineRow) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const d = await getAccountsAdminFineDetail({ fineId: fine.id });
      setDetail(d);
    } catch (e: any) { toast.error(e.message || 'Failed to load detail'); setDetailOpen(false); }
    finally { setDetailLoading(false); }
  };

  const handleReconcile = async () => {
    if (!detail) return;
    setReconciling(true);
    try {
      await reconcileAdminFine({ fineId: detail.fine.id });
      toast.success('Marked as reconciled');
      const refreshed = await getAccountsAdminFineDetail({ fineId: detail.fine.id });
      setDetail(refreshed);
      load();
    } catch (e: any) { toast.error(e.message || 'Failed to reconcile'); }
    finally { setReconciling(false); }
  };

  const counts = data?.statusCounts || {};

  if (loading && !data) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        <Skeleton className="h-60 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl">
      <FadeIn>
        <BackButton fallback="/accounts" />
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Administrative Fines</h1>

        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatChip icon={Clock} label="Pending" value={counts['Pending'] || 0} color="--chart-4" />
          <StatChip icon={CheckCircle2} label="Paid" value={counts['Paid'] || 0} color="--chart-3" />
          <StatChip icon={ShieldAlert} label="Disputed" value={counts['Disputed'] || 0} color="--chart-5" />
          <StatChip icon={XCircle} label="Cancelled" value={counts['Cancelled'] || 0} color="--muted-foreground" />
        </div>
      </FadeIn>

      <FadeIn delay={0.08}>
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by student, reason, or reference..."
              aria-label="Search administrative fines"
              className="pl-9 bg-accent/50 border-border/60"
            />
          </div>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-44 bg-accent/50 border-border/60"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_TABS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </FadeIn>

      {(!data || data.fines.length === 0) ? (
        <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No administrative fines match this filter.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-6 gap-2 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span className="col-span-2">Student / Reason</span><span>Reference</span><span>Amount</span><span>Issued By</span><span className="text-right">Status</span>
          </div>
          {data.fines.map((f, i) => (
            <motion.button
              key={f.id} type="button" onClick={() => openDetail(f)}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
              className="w-full text-left grid grid-cols-2 md:grid-cols-6 gap-2 items-center p-4 rounded-xl border border-border/60 bg-card hover:border-primary/20 transition-colors"
            >
              <div className="col-span-2">
                <p className="text-sm font-semibold text-foreground">{f.student.fullName || f.student.email}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{f.reason}</p>
              </div>
              <p className="text-xs font-mono text-muted-foreground hidden md:block">{f.reference || '—'}</p>
              <p className="text-sm font-bold text-foreground tabular">৳{f.amount.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground hidden md:block">{f.issuedBy?.fullName || '—'}</p>
              <div className="flex md:justify-end"><StatusBadge status={f.status} /></div>
            </motion.button>
          ))}

          {data.total > data.pageSize && (
            <div className="flex items-center justify-between pt-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
              <Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="glass-strong rounded-2xl sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Administrative Fine Detail</DialogTitle></DialogHeader>
          {detailLoading || !detail ? (
            <div className="space-y-3 py-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-border/60 bg-accent/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">{detail.fine.student.fullName}</span>
                  </div>
                  <StatusBadge status={detail.fine.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{detail.fine.student.studentId} · {detail.fine.student.email}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Reason</p><p className="font-medium text-foreground mt-0.5">{detail.fine.reason}</p></div>
                <div><p className="text-xs text-muted-foreground">Amount</p><p className="font-bold text-foreground tabular mt-0.5">৳{detail.fine.amount.toLocaleString()}</p></div>
                <div><p className="text-xs text-muted-foreground">Reference</p><p className="font-mono text-foreground mt-0.5">{detail.fine.reference || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Incident / Issue Date</p><p className="text-foreground mt-0.5">{detail.fine.incidentDate || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Issued By</p><p className="text-foreground mt-0.5">{detail.fine.issuedBy?.fullName || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Reconciled</p><p className="text-foreground mt-0.5">{detail.fine.reconciledAt ? new Date(detail.fine.reconciledAt).toLocaleString() : 'Not reconciled'}</p></div>
              </div>

              {detail.transaction && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Payment</p>
                  <div className="rounded-xl border border-border/60 bg-card p-3 flex items-center justify-between text-sm">
                    <span className="text-foreground">{detail.transaction.paymentMethod || 'Online'} · {detail.transaction.reference}</span>
                    <StatusBadge status={detail.transaction.status} />
                  </div>
                </div>
              )}

              {detail.ledgerEntries.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Ledger</p>
                  <div className="space-y-1.5">
                    {detail.ledgerEntries.map(l => (
                      <div key={l.id} className="flex items-center justify-between text-xs rounded-lg bg-accent/30 px-3 py-2">
                        <span className="text-muted-foreground">{l.type}</span>
                        <span className="font-semibold text-foreground tabular">৳{l.creditAmount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.auditTrail.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Audit Trail</p>
                  <div className="space-y-2">
                    {detail.auditTrail.map(a => (
                      <div key={a.id} className="text-xs border-l-2 border-border/60 pl-3">
                        <p className="text-foreground font-medium">{a.action} <span className="text-muted-foreground font-normal">— {a.actorName}</span></p>
                        {a.details && <p className="text-muted-foreground mt-0.5">{a.details}</p>}
                        <p className="text-muted-foreground/70 mt-0.5">{new Date(a.createdAt).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.fine.status === 'Paid' && (
                <Button onClick={handleReconcile} disabled={reconciling || !!detail.fine.reconciledAt} className="w-full">
                  {reconciling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BadgeCheck className="w-4 h-4 mr-2" />}
                  {detail.fine.reconciledAt ? 'Already Reconciled' : 'Mark Reconciled'}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
