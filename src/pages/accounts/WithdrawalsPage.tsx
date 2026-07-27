import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock, Banknote, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { getWithdrawals, processWithdrawal, type GetWithdrawalsOutputType } from '@/lib/api';
import { motion } from 'framer-motion';

type Withdrawal = GetWithdrawalsOutputType['withdrawals'][0];

export default function WithdrawalsPage() {
  const [data, setData] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Pending');
  const [search, setSearch] = useState('');
  const [actionItem, setActionItem] = useState<{ w: Withdrawal; action: 'approve' | 'reject' } | null>(null);
  const [processing, setProcessing] = useState(false);

  const load = () => {
    setLoading(true);
    getWithdrawals({ status: filter as any })
      .then(r => setData(r.withdrawals))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  const handleAction = async () => {
    if (!actionItem) return;
    setProcessing(true);
    try {
      const res = await processWithdrawal({ transactionId: actionItem.w.id, action: actionItem.action });
      toast.success(res.message);
      setActionItem(null);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setProcessing(false); }
  };

  const filtered = data.filter(w => {
    if (!search) return true;
    const q = search.toLowerCase();
    return w.studentName.toLowerCase().includes(q) || w.reference.toLowerCase().includes(q) || w.studentId.toLowerCase().includes(q);
  });

  const statusIcon = (s: string) => {
    if (s === 'Success') return <CheckCircle2 className="w-4 h-4 text-[hsl(var(--chart-3))]" />;
    if (s === 'Failed') return <XCircle className="w-4 h-4 text-destructive" />;
    return <Clock className="w-4 h-4 text-[hsl(var(--chart-4))]" />;
  };

  if (loading) return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-4">
      <Skeleton className="h-8 w-48" />
      {[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
    </div>
  );

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-xl font-bold text-foreground mb-6">
        <Banknote className="w-5 h-5 inline mr-2 text-primary" />Withdrawal Requests
      </motion.h1>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name, ID, reference..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-accent/50 border-border/60" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40 bg-accent/50 border-border/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Success">Approved</SelectItem>
            <SelectItem value="Failed">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Banknote className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">No withdrawal requests found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((w, i) => (
            <motion.div key={w.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="rounded-xl border border-border/60 bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {statusIcon(w.status)}
                    <span className="font-semibold text-sm text-foreground">{w.studentName || 'Student'}</span>
                    {w.studentId && <span className="text-xs text-muted-foreground font-mono">#{w.studentId}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{w.description}</p>
                  <p className="text-[10px] text-muted-foreground font-mono mt-1">{w.reference}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-foreground tabular">৳{(w.amount || 0).toLocaleString()}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    w.status === 'Pending' ? 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))]' :
                    w.status === 'Success' ? 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]' :
                    'bg-destructive/10 text-destructive'
                  }`}>{w.status}</span>
                </div>
              </div>
              {w.status === 'Pending' && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-border/40">
                  <Button size="sm" className="flex-1 h-9" onClick={() => setActionItem({ w, action: 'approve' })}>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-9 text-destructive hover:text-destructive" onClick={() => setActionItem({ w, action: 'reject' })}>
                    <XCircle className="w-3.5 h-3.5 mr-1.5" /> Reject
                  </Button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <AlertDialog open={!!actionItem} onOpenChange={v => !v && setActionItem(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{actionItem?.action === 'approve' ? 'Approve' : 'Reject'} Withdrawal?</AlertDialogTitle>
            <AlertDialogDescription>
              {actionItem?.action === 'approve'
                ? `Approve ৳${actionItem?.w.amount?.toLocaleString()} withdrawal for ${actionItem?.w.studentName}? The amount has already been held from their wallet.`
                : `Reject this withdrawal? ৳${actionItem?.w.amount?.toLocaleString()} will be refunded to ${actionItem?.w.studentName}'s wallet.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction} disabled={processing}
              className={actionItem?.action === 'reject' ? 'bg-destructive hover:bg-destructive/90' : ''}>
              {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {processing ? 'Processing...' : actionItem?.action === 'approve' ? 'Approve' : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
