import { useState, useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { Search, Store, PlusCircle, GraduationCap, ShieldAlert, Receipt, RotateCcw, FileWarning, ChevronLeft, ChevronRight, ChevronDown, ArrowRightLeft, Download, TrendingUp, TrendingDown } from 'lucide-react';
import { getTransactions, type GetTransactionsOutputType } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency, TYPE_LABELS } from '@/lib/mock-data';
import { useDebouncedCallback } from 'use-debounce';
import { FadeIn } from '@/components/PageTransition';
import TransactionDetailCard from '@/components/disputes/TransactionDetailCard';
import DisputeWizard from '@/components/disputes/DisputeWizard';
import type { TransactionDetail } from '@/lib/disputeApi';

type TxType = GetTransactionsOutputType['transactions'][0];

const typeIcons: Record<string, typeof Store> = {
  'Shop Payment': Store, 'Deposit': PlusCircle, 'Fee Payment': GraduationCap,
  'Fine Payment': ShieldAlert, 'Refund': RotateCcw, 'Mass Payment': FileWarning,
  'Top Up': Receipt, 'Transfer Sent': ArrowRightLeft, 'Transfer Received': PlusCircle,
  'Withdrawal': Download,
};

const PAGE_SIZE = 10;

export default function LedgerPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [transactions, setTransactions] = useState<TxType[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [wizardTx, setWizardTx] = useState<{ id: string; reference: string; amount: number; type: string } | null>(null);

  const fetchTxns = (s: string, type: string, pg: number) => {
    if (!user) return;
    setLoading(true);
    getTransactions({ search: s || undefined, type: type === 'all' ? undefined : type, offset: pg * PAGE_SIZE, limit: PAGE_SIZE })
      .then(data => { setTransactions(data.transactions); setHasMore(data.hasMore); })
      .finally(() => setLoading(false));
  };

  const debouncedSearch = useDebouncedCallback((val: string) => { setPage(0); fetchTxns(val, typeFilter, 0); }, 400);

  useEffect(() => { if (user) fetchTxns(search, typeFilter, page); }, [user, typeFilter, page]);

  const toggleExpand = (id: string) => setExpandedId(prev => (prev === id ? null : id));

  const handleRaiseDispute = (detail: TransactionDetail) => {
    setWizardTx({ id: detail.transaction.id, reference: detail.transaction.reference, amount: detail.transaction.amount, type: detail.transaction.type });
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl">
      <FadeIn>
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Transaction Ledger</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Complete history of all wallet activity</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search transactions..." value={search} onChange={(e) => { setSearch(e.target.value); debouncedSearch(e.target.value); }}
              className="pl-9 bg-accent/50 border-border/60" />
          </div>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-48 bg-accent/50 border-border/60"><SelectValue placeholder="All Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </FadeIn>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-18 rounded-xl" />)}</div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed border-border bg-card/50">
          <Receipt className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">No transactions found</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block rounded-2xl border border-border/60 overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead><tr className="bg-accent/50 border-b border-border/40">
                <th className="text-left px-4 py-3 text-muted-foreground font-semibold text-xs uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-semibold text-xs uppercase tracking-wider">Description</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-semibold text-xs uppercase tracking-wider">Ref</th>
                <th className="text-right px-4 py-3 text-muted-foreground font-semibold text-xs uppercase tracking-wider">Amount</th>
                <th className="text-center px-4 py-3 text-muted-foreground font-semibold text-xs uppercase tracking-wider">Status</th>
                <th className="w-12"></th>
              </tr></thead>
              <tbody>
                {transactions.map((tx, i) => {
                  const Icon = typeIcons[tx.type] || Store;
                  const isCredit = tx.direction === 'Credit';
                  const expanded = expandedId === tx.id;
                  return (
                    <Fragment key={tx.id}>
                      <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                        onClick={() => tx.status === 'Success' && toggleExpand(tx.id)}
                        className={`border-t border-border/30 hover:bg-accent/30 transition-colors ${tx.status === 'Success' ? 'cursor-pointer' : ''}`}>
                        <td className="px-4 py-3.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isCredit ? 'bg-[hsl(var(--chart-3))]/10' : 'bg-accent'}`}>
                            <Icon className={`w-4 h-4 ${isCredit ? 'text-[hsl(var(--chart-3))]' : 'text-muted-foreground'}`} />
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="text-foreground font-medium flex items-center gap-1.5">
                            {tx.description || tx.type}
                            {tx.status === 'Success' && <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{tx.type}{tx.paymentMethod ? ` · ${tx.paymentMethod}` : tx.gateway ? ` · ${tx.gateway === 'SSLCommerz' ? 'Online' : tx.gateway}` : ''}</div>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground text-xs font-mono">{tx.reference}</td>
                        <td className={`px-4 py-3.5 text-right font-bold tabular-nums ${isCredit ? 'text-[hsl(var(--chart-3))]' : 'text-foreground'}`}>
                          <span className="flex items-center justify-end gap-1">
                            {isCredit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3 text-muted-foreground" />}
                            {isCredit ? '+' : '−'}{formatCurrency(tx.amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center"><StatusBadge status={tx.status.toLowerCase()} /></td>
                        <td className="px-4 py-3.5">
                          <button onClick={(e) => { e.stopPropagation(); navigate(`/student/receipt?txId=${tx.id}`); }} className="p-2 rounded-lg hover:bg-accent transition-colors" title="Receipt">
                            <Download className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        </td>
                      </motion.tr>
                      {expanded && (
                        <tr>
                          <td colSpan={6} className="px-4 pb-4">
                            <AnimatePresence>
                              <TransactionDetailCard transactionId={tx.id} onRaiseDispute={handleRaiseDispute} />
                            </AnimatePresence>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden flex flex-col gap-2">
            {transactions.map((tx, i) => {
              const Icon = typeIcons[tx.type] || Store;
              const isCredit = tx.direction === 'Credit';
              const expanded = expandedId === tx.id;
              return (
                <div key={tx.id}>
                  <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    onClick={() => tx.status === 'Success' ? toggleExpand(tx.id) : navigate(`/student/receipt?txId=${tx.id}`)}
                    className="w-full p-4 rounded-xl border border-border/60 bg-card text-left hover:border-primary/20 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isCredit ? 'bg-[hsl(var(--chart-3))]/10' : 'bg-accent'}`}>
                          <Icon className={`w-4 h-4 ${isCredit ? 'text-[hsl(var(--chart-3))]' : 'text-muted-foreground'}`} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-foreground">{tx.description || tx.type}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{tx.reference}</div>
                        </div>
                      </div>
                      <StatusBadge status={tx.status.toLowerCase()} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className={`font-bold text-sm tabular-nums flex items-center gap-1 ${isCredit ? 'text-[hsl(var(--chart-3))]' : 'text-foreground'}`}>
                        {isCredit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3 text-muted-foreground" />}
                        {isCredit ? '+' : '−'}{formatCurrency(tx.amount)}
                      </div>
                      {tx.status === 'Success' && <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />}
                    </div>
                  </motion.button>
                  {expanded && <AnimatePresence><TransactionDetailCard transactionId={tx.id} onRaiseDispute={handleRaiseDispute} /></AnimatePresence>}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-6">
            <span className="text-xs text-muted-foreground font-medium">Page {page + 1}</span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-9 w-9 p-0">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage(p => p + 1)} className="h-9 w-9 p-0">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {wizardTx && (
        <DisputeWizard
          open={!!wizardTx}
          onOpenChange={(v) => !v && setWizardTx(null)}
          transactionId={wizardTx.id}
          transactionSummary={wizardTx}
          onSubmitted={() => fetchTxns(search, typeFilter, page)}
        />
      )}
    </div>
  );
}
