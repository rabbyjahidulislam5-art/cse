import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebouncedCallback } from 'use-debounce';
import { motion } from 'framer-motion';
import { Search, CheckCircle2, Clock, ArrowUpRight, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import { getShopDashboard, searchShopTransactions, type GetShopDashboardOutputType, type ShopTransactionSearchResult } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';
import BackButton from '@/components/BackButton';

export default function ShopPaymentsPage() {
  const navigate = useNavigate();

  // Outstanding (Pending) — reuses /shop/dashboard's already-computed pendingPayLater, which was
  // previously fetched but never rendered anywhere in the Shop module.
  const [dashboard, setDashboard] = useState<GetShopDashboardOutputType | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  // Completed (Settled) — real server-side filtering.
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [completed, setCompleted] = useState<ShopTransactionSearchResult | null>(null);
  const [completedLoading, setCompletedLoading] = useState(true);

  useEffect(() => {
    getShopDashboard({}).then(setDashboard).catch(() => toast.error('Failed to load outstanding payments')).finally(() => setDashboardLoading(false));
  }, []);

  const loadCompleted = useCallback(() => {
    setCompletedLoading(true);
    searchShopTransactions({
      studentId: studentId || undefined, studentName: studentName || undefined,
      dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, transactionId: transactionId || undefined,
      page, pageSize: 20,
    })
      .then(setCompleted)
      .catch(() => toast.error('Failed to load completed payments'))
      .finally(() => setCompletedLoading(false));
  }, [studentId, studentName, dateFrom, dateTo, transactionId, page]);

  const debouncedLoad = useDebouncedCallback(loadCompleted, 350);
  useEffect(() => { debouncedLoad(); }, [studentId, studentName, dateFrom, dateTo, transactionId, page, debouncedLoad]);

  const clearFilters = () => { setStudentId(''); setStudentName(''); setDateFrom(''); setDateTo(''); setTransactionId(''); setPage(1); };
  const hasFilters = studentId || studentName || dateFrom || dateTo || transactionId;

  const pendingPayLater = dashboard?.pendingPayLater || [];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <FadeIn>
        <BackButton fallback="/shop" />
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Payments</h1>
            <p className="text-xs text-muted-foreground mt-1">Completed and outstanding student payments for your shop.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate('/shop/settlements')}>
            <ArrowUpRight className="w-4 h-4 mr-1.5" /> Request Settlement
          </Button>
        </div>
      </FadeIn>

      <Tabs defaultValue="completed">
        <TabsList className="w-full grid grid-cols-2 mb-5">
          <TabsTrigger value="completed">
            <CheckCircle2 className="w-4 h-4 mr-1.5" /> Completed{completed ? ` (${completed.total})` : ''}
          </TabsTrigger>
          <TabsTrigger value="outstanding">
            <Clock className="w-4 h-4 mr-1.5" /> Outstanding{pendingPayLater.length ? ` (${pendingPayLater.length})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="completed">
          <FadeIn delay={0.05}>
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={transactionId} onChange={e => { setTransactionId(e.target.value); setPage(1); }}
                  placeholder="Search by Transaction ID / Reference..."
                  className="pl-9 bg-accent/50 border-border/60"
                />
              </div>
              <Button type="button" variant="outline" size="icon" aria-label="Toggle filters" onClick={() => setShowFilters(v => !v)} className={hasFilters ? 'border-primary/40 text-primary' : ''}>
                <Filter className="w-4 h-4" />
              </Button>
            </div>

            {showFilters && (
              <div className="rounded-2xl border border-border/60 bg-card p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Input value={studentId} onChange={e => { setStudentId(e.target.value); setPage(1); }} placeholder="Student ID" className="bg-accent/50 border-border/60" />
                <Input value={studentName} onChange={e => { setStudentName(e.target.value); setPage(1); }} placeholder="Student Name" className="bg-accent/50 border-border/60" />
                <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="bg-accent/50 border-border/60" />
                <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="bg-accent/50 border-border/60" />
                {hasFilters && (
                  <button type="button" onClick={clearFilters} className="col-span-2 sm:col-span-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1">
                    <X className="w-3.5 h-3.5" /> Clear filters
                  </button>
                )}
              </div>
            )}

            {completedLoading && !completed ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : !completed || completed.transactions.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
                <CheckCircle2 className="w-9 h-9 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No completed payments match this filter.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {completed.transactions.map((t, i) => (
                  <motion.div
                    key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                    className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/60 bg-card"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{t.studentName || 'Student'}</p>
                      {t.description && <p className="text-xs text-foreground/80 truncate mt-0.5">{t.description}</p>}
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{t.studentId} · {t.reference} · {new Date(t.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-foreground tabular">{formatCurrency(t.amount)}</span>
                      <StatusBadge status={t.status} />
                    </div>
                  </motion.div>
                ))}

                {completed.total > completed.pageSize && (
                  <div className="flex items-center justify-between pt-3">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
                    <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(completed.total / completed.pageSize)}</span>
                    <Button variant="outline" size="sm" disabled={page * completed.pageSize >= completed.total} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                )}
              </div>
            )}
          </FadeIn>
        </TabsContent>

        <TabsContent value="outstanding">
          <FadeIn delay={0.05}>
            {dashboardLoading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : pendingPayLater.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
                <Clock className="w-9 h-9 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No outstanding payments — every student is settled up.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground px-1 mb-1">
                  Only Accounts Office (or an automatic wallet deduction after 10 days unpaid) can settle these — shop accounts cannot mark a due as paid directly.
                </p>
                {pendingPayLater.map((p, i) => (
                  <motion.div
                    key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                    className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/60 bg-card"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{p.studentName || 'Student'}</p>
                      <p className="text-xs text-foreground/80 truncate mt-0.5">{p.description || 'Pay Later purchase'}{p.reference ? ` · ${p.reference}` : ''}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{p.studentId} · {new Date(p.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-destructive tabular">{formatCurrency(p.amount)}</span>
                      <StatusBadge status={p.status} />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </FadeIn>
        </TabsContent>
      </Tabs>
    </div>
  );
}
