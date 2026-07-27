import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import PinDialog from '@/components/PinDialog';
import { toast } from 'sonner';
import { GraduationCap, BookOpen, ShieldAlert, Loader2, CheckCircle2, Clock, Banknote, CreditCard, Shield } from 'lucide-react';
import { getDues, payDues as payDuesEndpoint, disputeFine, initSSLPayment, type GetDuesOutputType } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type DueItem = GetDuesOutputType['semester'][0];

export default function DuesPage() {
  const { user, refreshDashboard } = useUser();
  const [dues, setDues] = useState<GetDuesOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeFineId, setDisputeFineId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [confirmPayOpen, setConfirmPayOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'bulk' | 'single' | null>(null);
  const [singleItem, setSingleItem] = useState<DueItem | null>(null);

  const loadDues = () => {
    if (!user) return;
    setLoading(true);
    getDues({}).then(setDues).finally(() => setLoading(false));
  };

  useEffect(() => { loadDues(); }, [user]);

  const toggleItem = (id: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const allItems = dues ? [...dues.semester, ...dues.library, ...dues.admin, ...dues.payLater] : [];
  const payableItems = allItems.filter(d => selected.has(d.id) && d.status === 'pending');
  const totalSelected = payableItems.reduce((sum, d) => sum + d.amount, 0);

  const totalPending = allItems.filter(d => d.status === 'pending' || d.status === 'overdue').reduce((s, d) => s + d.amount, 0);

  const handlePaySelected = () => { if (payableItems.length === 0) { toast.error('Select pending items'); return; } setPendingAction('bulk'); setConfirmPayOpen(true); };
  const confirmPay = () => { setConfirmPayOpen(false); setPinOpen(true); };

  const executeBulkPay = async () => {
    if (!user) return;
    setPaying(true);
    try {
      await payDuesEndpoint({ items: payableItems.map(d => ({ id: d.id, source: d.source, amount: d.amount, label: d.label })) });
      toast.success(`${payableItems.length} item${payableItems.length > 1 ? 's' : ''} paid`);
      setSelected(new Set()); refreshDashboard(); loadDues();
    } catch (e: any) { toast.error(e.message || 'Payment failed'); }
    finally { setPaying(false); }
  };

  const handlePaySingle = (item: DueItem) => { setSingleItem(item); setPendingAction('single'); setPinOpen(true); };

  const executeSinglePay = async () => {
    if (!user || !singleItem) return;
    setPaying(true);
    try {
      await payDuesEndpoint({ items: [{ id: singleItem.id, source: singleItem.source, amount: singleItem.amount, label: singleItem.label }] });
      toast.success(`${singleItem.label} paid`); refreshDashboard(); loadDues();
    } catch (e: any) { toast.error(e.message || 'Payment failed'); }
    finally { setPaying(false); setSingleItem(null); }
  };

  const handleSSLPay = async (item: DueItem) => {
    if (!user) return;
    setPaying(true);
    const purposeMap: Record<string, 'semester_fee' | 'library_fine' | 'admin_fine' | 'pay_later'> = { semester: 'semester_fee', library: 'library_fine', admin: 'admin_fine', payLater: 'pay_later' };
    try {
      const res = await initSSLPayment({ amount: item.amount, purpose: purposeMap[item.source] || 'semester_fee', itemId: item.id, itemLabel: item.label });
      localStorage.setItem('ssl_payment', JSON.stringify({ ref: res.transactionRef, purpose: purposeMap[item.source] || 'semester_fee', itemId: item.id }));
      window.location.href = res.gatewayUrl;
    } catch (e: any) { toast.error(e.message || 'Payment gateway failed'); }
    finally { setPaying(false); }
  };

  const handleDispute = async () => {
    if (!disputeFineId || disputeReason.length < 10 || !user) { toast.error('Provide a reason (min 10 chars)'); return; }
    try {
      await disputeFine({ fineId: disputeFineId, reason: disputeReason });
      setDisputeOpen(false); setDisputeReason('');
      toast.success('Dispute submitted'); loadDues();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
  };

  const onPinSuccess = () => { if (pendingAction === 'bulk') executeBulkPay(); else if (pendingAction === 'single') executeSinglePay(); setPendingAction(null); };

  const renderList = (items: DueItem[], source: string) => {
    if (!items || items.length === 0) {
      return (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-card/50">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-[hsl(var(--chart-3))]/20" />
          <p className="text-sm font-medium text-muted-foreground">All clear — no pending items</p>
        </div>
      );
    }
    const pending = items.filter(i => i.status === 'pending' || i.status === 'under review' || i.status === 'overdue');
    const done = items.filter(i => i.status === 'paid' || i.status === 'waived' || i.status === 'cancelled');

    return (
      <div className="flex flex-col gap-2">
        {[...pending, ...done].map((item, idx) => {
          const canPay = item.status === 'pending' || item.status === 'overdue';
          const canDispute = source === 'admin' && item.status === 'pending';
          return (
            <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
              className={`flex items-center gap-3 p-4 rounded-xl border bg-card transition-colors ${canPay ? 'border-border/60 hover:border-primary/20' : 'border-border/40'}`}>
              {canPay && <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleItem(item.id)} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground truncate">{item.label}</span>
                  <StatusBadge status={item.status} />
                </div>
                {item.status === 'under review' && <p className="text-[10px] text-muted-foreground mt-1">Dispute submitted — awaiting review</p>}
              </div>
              <span className={`text-sm font-bold tabular-nums shrink-0 ${canPay ? 'text-foreground' : 'text-muted-foreground'}`}>{formatCurrency(item.amount)}</span>
              {canPay && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" className="h-8 text-xs px-3 font-semibold" onClick={() => handlePaySingle(item)} disabled={paying}>
                    <CreditCard className="w-3 h-3 mr-1" /> Pay
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={() => handleSSLPay(item)} disabled={paying} title="Pay Online">
                    <Banknote className="w-3.5 h-3.5" />
                  </Button>
                  {canDispute && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => { setDisputeFineId(item.id); setDisputeOpen(true); }}>Dispute</Button>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-4">
        <Skeleton className="h-8 w-48" /><Skeleton className="h-10 w-full" />
        {[1,2,3].map(i => <Skeleton key={i} className="h-18 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <FadeIn>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Dues & Fines</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalPending > 0 ? `Total pending: ${formatCurrency(totalPending)}` : 'All dues cleared!'}
            </p>
          </div>
          {payableItems.length > 0 && (
            <Button onClick={handlePaySelected} disabled={paying} className="font-semibold">
              {paying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Pay Selected ({payableItems.length}) — {formatCurrency(totalSelected)}
            </Button>
          )}
        </div>
      </FadeIn>

      <Tabs defaultValue="semester">
        <TabsList className="w-full sm:w-auto mb-5 bg-accent/50 p-1 rounded-xl">
          <TabsTrigger value="semester" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm"><GraduationCap className="w-3.5 h-3.5" /> Semester</TabsTrigger>
          <TabsTrigger value="library" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm"><BookOpen className="w-3.5 h-3.5" /> Library</TabsTrigger>
          <TabsTrigger value="admin" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm"><ShieldAlert className="w-3.5 h-3.5" /> Admin</TabsTrigger>
          <TabsTrigger value="payLater" className="gap-1.5 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm"><Clock className="w-3.5 h-3.5" /> Pay Later</TabsTrigger>
        </TabsList>
        <TabsContent value="semester">{renderList(dues?.semester || [], 'semester')}</TabsContent>
        <TabsContent value="library">{renderList(dues?.library || [], 'library')}</TabsContent>
        <TabsContent value="admin">{renderList(dues?.admin || [], 'admin')}</TabsContent>
        <TabsContent value="payLater">{renderList(dues?.payLater || [], 'payLater')}</TabsContent>
      </Tabs>

      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent className="glass-strong rounded-2xl sm:max-w-md">
          <DialogHeader><DialogTitle>Dispute Fine</DialogTitle><DialogDescription>Explain why this fine should be reviewed</DialogDescription></DialogHeader>
          <Textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="Provide detailed reason (min 10 chars)..." rows={4} className="bg-accent/50 border-border/60" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeOpen(false)}>Cancel</Button>
            <Button onClick={handleDispute} disabled={disputeReason.length < 10}>Submit Dispute</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmPayOpen} onOpenChange={setConfirmPayOpen}>
        <AlertDialogContent className="glass-strong rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Payment</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to pay {payableItems.length} item{payableItems.length > 1 ? 's' : ''} totaling <strong>{formatCurrency(totalSelected)}</strong> from your wallet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPay}>Continue to PIN</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode="verify" onSuccess={onPinSuccess} />
    </div>
  );
}
