import { useState, useEffect, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { Clock, CheckCircle2, XCircle, LayoutGrid, ChevronDown, CreditCard, ChevronLeft, ChevronRight } from 'lucide-react';
import { getTransactions, type GetTransactionsOutputType } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';
import TransactionDetailCard from '@/components/disputes/TransactionDetailCard';
import DisputeWizard from '@/components/disputes/DisputeWizard';
import type { TransactionDetail } from '@/lib/disputeApi';

type TxType = GetTransactionsOutputType['transactions'][0];
type TabKey = 'pending' | 'confirmed' | 'cancelled' | 'all';

// Every payment surface in the app (semester fee, library/admin fine, shop payment, wallet
// top-up via SSLCommerz; withdrawal via bKash/Nagad/Rocket) is routed through an external
// gateway and lands in `Transaction.gateway`. This dashboard is scoped to those — internal
// wallet-to-wallet transfers (`gateway: 'Wallet'`) are excluded server-side and already have
// their own view in the Ledger.
const TAB_STATUS: Record<TabKey, string[] | undefined> = {
  pending: ['Pending'],
  confirmed: ['Success'],
  cancelled: ['Failed', 'Cancelled'],
  all: undefined,
};

const PAGE_SIZE = 10;

export default function PaymentsDashboardPage() {
  const { user } = useUser();
  const [tab, setTab] = useState<TabKey>('pending');
  const [page, setPage] = useState(0);
  const [transactions, setTransactions] = useState<TxType[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [wizardTx, setWizardTx] = useState<{ id: string; reference: string; amount: number; type: string } | null>(null);

  const fetchTxns = (t: TabKey, pg: number) => {
    if (!user) return;
    setLoading(true);
    getTransactions({ status: TAB_STATUS[t], gatewayOnly: true, offset: pg * PAGE_SIZE, limit: PAGE_SIZE })
      .then(data => {
        setTransactions(data.transactions);
        setHasMore(data.hasMore);
        if (data.statusCounts) setCounts(data.statusCounts);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (user) fetchTxns(tab, page); }, [user, tab, page]);

  const toggleExpand = (id: string) => setExpandedId(prev => (prev === id ? null : id));

  const handleRaiseDispute = (detail: TransactionDetail) => {
    setWizardTx({ id: detail.transaction.id, reference: detail.transaction.reference, amount: detail.transaction.amount, type: detail.transaction.type });
  };

  const pendingCount = counts['Pending'] || 0;
  const confirmedCount = counts['Success'] || 0;
  const cancelledCount = (counts['Failed'] || 0) + (counts['Cancelled'] || 0);
  const allCount = pendingCount + confirmedCount + cancelledCount;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl">
      <FadeIn>
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Payments Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">All gateway-routed payments — SSLCommerz fees/fines/top-ups, shop payments & mobile banking withdrawals</p>
        </div>
      </FadeIn>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as TabKey); setPage(0); setExpandedId(null); }}>
        <TabsList className="w-full sm:w-auto mb-5 bg-accent/50 p-1 rounded-xl flex-wrap h-auto">
          <TabsTrigger value="pending" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
            <Clock className="w-3.5 h-3.5" /> Pending {pendingCount > 0 && <span className="text-[10px] text-muted-foreground">({pendingCount})</span>}
          </TabsTrigger>
          <TabsTrigger value="confirmed" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
            <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed {confirmedCount > 0 && <span className="text-[10px] text-muted-foreground">({confirmedCount})</span>}
          </TabsTrigger>
          <TabsTrigger value="cancelled" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
            <XCircle className="w-3.5 h-3.5" /> Cancelled {cancelledCount > 0 && <span className="text-[10px] text-muted-foreground">({cancelledCount})</span>}
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
            <LayoutGrid className="w-3.5 h-3.5" /> All {allCount > 0 && <span className="text-[10px] text-muted-foreground">({allCount})</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} forceMount>
          {loading ? (
            <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-18 rounded-xl" />)}</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
              <CreditCard className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
              <p className="text-sm font-medium text-muted-foreground">No {tab === 'all' ? '' : tab} payments found</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {transactions.map((tx, i) => {
                  const expanded = expandedId === tx.id;
                  return (
                    <Fragment key={tx.id}>
                      <motion.button
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                        onClick={() => tx.status === 'Success' && toggleExpand(tx.id)}
                        className={`w-full p-4 rounded-xl border border-border/60 bg-card text-left transition-colors ${tx.status === 'Success' ? 'hover:border-primary/20 cursor-pointer' : 'cursor-default'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                              {tx.description || tx.type}
                              {tx.status === 'Success' && <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} />}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {tx.type} · <span className="font-mono">{tx.reference}</span>
                              {tx.gateway ? ` · ${tx.gateway === 'SSLCommerz' ? 'Online' : tx.gateway}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-bold text-sm tabular-nums text-foreground">{formatCurrency(tx.amount)}</span>
                            <StatusBadge status={tx.status.toLowerCase()} />
                          </div>
                        </div>
                      </motion.button>
                      {expanded && (
                        <AnimatePresence>
                          <TransactionDetailCard transactionId={tx.id} onRaiseDispute={handleRaiseDispute} />
                        </AnimatePresence>
                      )}
                    </Fragment>
                  );
                })}
              </div>

              <div className="flex items-center justify-between mt-6">
                <span className="text-xs text-muted-foreground font-medium">Page {page + 1}</span>
                <div className="flex gap-1.5">
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                    className="h-9 w-9 p-0 rounded-xl border border-border/60 flex items-center justify-center disabled:opacity-40 hover:bg-accent transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button disabled={!hasMore} onClick={() => setPage(p => p + 1)}
                    className="h-9 w-9 p-0 rounded-xl border border-border/60 flex items-center justify-center disabled:opacity-40 hover:bg-accent transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {wizardTx && (
        <DisputeWizard
          open={!!wizardTx}
          onOpenChange={(v) => !v && setWizardTx(null)}
          transactionId={wizardTx.id}
          transactionSummary={wizardTx}
          onSubmitted={() => fetchTxns(tab, page)}
        />
      )}
    </div>
  );
}
