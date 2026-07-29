import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import PinDialog from '@/components/PinDialog';
import OtpDialog from '@/components/OtpDialog';
import PaymentConfirmModal from '@/components/PaymentConfirmModal';
import { toast } from 'sonner';
import { GraduationCap, BookOpen, ShieldAlert, Loader2, CheckCircle2, Clock, CreditCard } from 'lucide-react';
import { getDues, disputeFine, initSSLPayment, PIN_REQUIRED_THRESHOLD, OTP_REQUIRED_THRESHOLD, type GetDuesOutputType, type SslPayItem } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type DueItem = GetDuesOutputType['semester'][0];
type SslPurpose = 'semester_fee' | 'library_fine' | 'admin_fine' | 'pay_later' | 'mass_pay';

const RECEIVER_ROLE_MAP: Record<string, string> = { semester: 'Accounts Office', library: 'Library', admin: 'Admin Office', payLater: 'Shop' };
const PURPOSE_MAP: Record<string, SslPurpose> = { semester: 'semester_fee', library: 'library_fine', admin: 'admin_fine', payLater: 'pay_later' };

interface PendingPayment {
  items: SslPayItem[];
  purpose: SslPurpose;
  itemLabel: string;
  receiverName: string;
}

export default function DuesPage() {
  const { user, wallet, refreshDashboard } = useUser();
  const walletBalance = wallet?.balance ?? 0;
  const [dues, setDues] = useState<GetDuesOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeFineId, setDisputeFineId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  // Tiered payment authorization: confirm -> (PIN if amount is medium+) -> (OTP if amount is large) -> gateway.
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);

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

  const pendingAmount = pending ? pending.items.reduce((s, i) => s + i.amount, 0) : 0;

  const handlePaySelected = () => {
    if (payableItems.length === 0) { toast.error('Select pending items'); return; }
    if (walletBalance < totalSelected) {
      toast.error(`Insufficient Wallet Balance. Available: ৳${walletBalance.toLocaleString()}, Required: ৳${totalSelected.toLocaleString()}`);
      return;
    }
    const uniqueSources = new Set(payableItems.map(d => d.source));
    const receiverName = uniqueSources.size === 1 ? (RECEIVER_ROLE_MAP[[...uniqueSources][0]] || 'Campus Office') : 'Multiple Offices';
    setPending({
      items: payableItems.map(d => ({ id: d.id, source: d.source as SslPayItem['source'], amount: d.amount, label: d.label })),
      purpose: 'mass_pay',
      itemLabel: `${payableItems.length} selected dues`,
      receiverName,
    });
    setConfirmOpen(true);
  };

  const handlePaySingle = (item: DueItem) => {
    if (walletBalance < item.amount) {
      toast.error(`Insufficient Wallet Balance. Available: ৳${walletBalance.toLocaleString()}, Required: ৳${item.amount.toLocaleString()}`);
      return;
    }
    setPending({
      items: [{ id: item.id, source: item.source as SslPayItem['source'], amount: item.amount, label: item.label }],
      purpose: PURPOSE_MAP[item.source] || 'semester_fee',
      itemLabel: item.label,
      receiverName: RECEIVER_ROLE_MAP[item.source] || 'Campus Office',
    });
    setConfirmOpen(true);
  };

  const executePayment = async (otpId?: string) => {
    if (!pending) return;
    setPaying(true);
    try {
      const res = await initSSLPayment({ items: pending.items, purpose: pending.purpose as any, itemLabel: pending.itemLabel, otpId });
      localStorage.setItem('ssl_payment', JSON.stringify({ ref: res.transactionRef }));
      window.location.href = res.gatewayUrl;
    } catch (e: any) {
      if (e.requiresPin) { setPinOpen(true); }
      else if (e.requiresOtp) { setOtpOpen(true); }
      else { toast.error(e.message || 'Payment gateway failed'); }
      setPaying(false);
    }
  };

  // Confirm step complete — gate by amount before actually opening a gateway session.
  const onConfirmed = () => {
    setConfirmOpen(false);
    if (pendingAmount >= PIN_REQUIRED_THRESHOLD) { setPinOpen(true); return; }
    executePayment();
  };

  const onPinVerified = () => {
    if (pendingAmount >= OTP_REQUIRED_THRESHOLD) { setOtpOpen(true); return; }
    executePayment();
  };

  const onOtpVerified = (otpId: string) => executePayment(otpId);

  const handleDispute = async () => {
    if (!disputeFineId || disputeReason.length < 10 || !user) { toast.error('Provide a reason (min 10 chars)...'); return; }
    try {
      await disputeFine({ fineId: disputeFineId, reason: disputeReason });
      setDisputeOpen(false); setDisputeReason('');
      toast.success('Dispute submitted'); loadDues();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
  };

  const renderList = (items: DueItem[], source: string) => {
    if (!items || items.length === 0) {
      return (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-card/50">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-[hsl(var(--chart-3))]/20" />
          <p className="text-sm font-medium text-muted-foreground">All clear — no pending items</p>
        </div>
      );
    }
    const pendingItems = items.filter(i => i.status === 'pending' || i.status === 'under review' || i.status === 'overdue');
    const done = items.filter(i => i.status === 'paid' || i.status === 'waived' || i.status === 'cancelled');

    return (
      <div className="flex flex-col gap-2">
        {[...pendingItems, ...done].map((item, idx) => {
          const canPay = item.status === 'pending' || item.status === 'overdue';
          const canDispute = source === 'admin' && item.status === 'pending';
          const isInsufficient = walletBalance < item.amount;
          return (
            <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
              className={`flex items-center gap-3 p-4 rounded-xl border bg-card transition-colors ${canPay ? 'border-border/60 hover:border-primary/20' : 'border-border/40'}`}>
              {canPay && <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleItem(item.id)} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground truncate">{item.label}</span>
                  <div className="flex items-center gap-2">
                    {canPay && isInsufficient && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                        Insufficient Balance
                      </span>
                    )}
                    <StatusBadge status={item.status} />
                  </div>
                </div>
                {item.status === 'under review' && <p className="text-[10px] text-muted-foreground mt-1">Dispute submitted — awaiting review</p>}
                {canPay && isInsufficient && <p className="text-[10px] text-destructive/80 mt-1">Wallet balance: {formatCurrency(walletBalance)} (Short by {formatCurrency(item.amount - walletBalance)})</p>}
              </div>
              <span className={`text-sm font-bold tabular-nums shrink-0 ${canPay ? 'text-foreground' : 'text-muted-foreground'}`}>{formatCurrency(item.amount)}</span>
              {canPay && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    className="h-8 text-xs px-3 font-semibold"
                    onClick={() => handlePaySingle(item)}
                    disabled={paying || isInsufficient}
                    title={isInsufficient ? `Insufficient Wallet Balance (${formatCurrency(walletBalance)} available)` : undefined}
                  >
                    <CreditCard className="w-3 h-3 mr-1" /> Pay
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

      {pending && (
        <PaymentConfirmModal
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          receiverName={pending.receiverName}
          payerName={user?.fullName}
          amount={pendingAmount}
          lineItems={pending.items.map(i => ({ label: i.label, amount: i.amount }))}
          loading={paying}
          onConfirm={onConfirmed}
        />
      )}
      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode="verify" verifyLength={user?.pinLength || 4} onSuccess={onPinVerified} />
      <OtpDialog open={otpOpen} onOpenChange={setOtpOpen} purpose="Large Payment" onSuccess={onOtpVerified} />
    </div>
  );
}
