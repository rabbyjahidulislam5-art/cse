import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRightLeft, User, ChevronRight, Shield, Wallet, Loader2, CheckCircle2, UserCheck, GraduationCap, Building, Hash, Mail, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import PinDialog from '@/components/PinDialog';
import OtpDialog from '@/components/OtpDialog';
import SuccessScreen from '@/components/SuccessScreen';
import DisputeWizard from '@/components/disputes/DisputeWizard';
import { toast } from 'sonner';
import { transferMoney, lookupTransferRecipient } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type Step = 'recipient' | 'recipient_info' | 'amount' | 'review' | 'processing' | 'success';

type RecipientDetails = {
  id: string;
  fullName: string;
  email: string;
  studentId: string;
  department: string;
  batch: string;
};

export default function TransferPage() {
  const navigate = useNavigate();
  const { user, wallet, refreshDashboard } = useUser();
  const [step, setStep] = useState<Step>('recipient');
  const [recipientInput, setRecipientInput] = useState('');
  const [recipientDetails, setRecipientDetails] = useState<RecipientDetails | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [searching, setSearching] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [success, setSuccess] = useState<{ transactionId: string; recipientName: string; amount: number; newBalance: number } | null>(null);

  const amt = parseFloat(amount) || 0;

  const stepIndex = ['recipient', 'recipient_info', 'amount', 'review', 'processing', 'success'].indexOf(step);
  const progress = step === 'success' ? 100 : (stepIndex / 5) * 100;

  const handleLookupRecipient = async () => {
    const query = recipientInput.trim();
    if (!query) { toast.error('Enter recipient email or student ID'); return; }
    setSearching(true);
    try {
      const res = await lookupTransferRecipient({ recipientIdentifier: query });
      setRecipientDetails(res.recipient);
      setStep('recipient_info');
    } catch (e: any) {
      toast.error(e.message || 'Recipient not found');
    } finally {
      setSearching(false);
    }
  };

  const handleToAmount = () => {
    if (!recipientDetails) return;
    setStep('amount');
  };

  const handleToReview = () => {
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (amt > (wallet?.balance || 0)) { toast.error('Insufficient balance'); return; }
    setStep('review');
  };

  const handleStartAuth = () => {
    setPinOpen(true);
  };

  const onPinVerified = () => {
    setOtpOpen(true);
  };

  const onOtpVerified = () => {
    executeTransfer();
  };

  const executeTransfer = async () => {
    if (!recipientDetails) return;
    setStep('processing');
    try {
      const res = await transferMoney({ recipientIdentifier: recipientDetails.email, amount: amt, note: note.trim() || undefined });
      setSuccess({ transactionId: res.transactionId, recipientName: res.recipientName, amount: amt, newBalance: res.newBalance });
      setStep('success');
      refreshDashboard();
    } catch (e: any) {
      toast.error(e.message || 'Transfer failed');
      setStep('review');
    }
  };

  const reset = () => {
    setStep('recipient');
    setRecipientInput('');
    setRecipientDetails(null);
    setAmount('');
    setNote('');
    setSuccess(null);
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => step === 'recipient' ? navigate(-1) : reset()} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">Fund Transfer</h1>
          <p className="text-xs text-muted-foreground">Send money securely to another student</p>
        </div>
      </div>

      {/* Progress */}
      {!['success'].includes(step) && (
        <div className="h-1 bg-accent rounded-full mb-6 overflow-hidden">
          <motion.div className="h-full gradient-primary rounded-full" animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
        </div>
      )}

      {/* Balance card */}
      {!['processing','success'].includes(step) && (
        <FadeIn>
          <div className="rounded-xl border border-border/60 bg-card p-4 mb-6 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Available Balance</p>
              <p className="text-xl font-bold text-foreground tabular">{formatCurrency(wallet?.balance || 0)}</p>
            </div>
          </div>
        </FadeIn>
      )}

      <AnimatePresence mode="wait">
        {/* RECIPIENT */}
        {step === 'recipient' && (
          <FadeIn key="recip">
            <div className="space-y-5">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recipient Identifier</Label>
                <div className="relative mt-2">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={recipientInput}
                    onChange={e => setRecipientInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleLookupRecipient(); }}
                    placeholder="Email or Student ID"
                    className="pl-10 h-12 bg-accent/50 border-border/60"
                    disabled={searching}
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Enter the recipient's university email or student ID</p>
              </div>
              <Button onClick={handleLookupRecipient} className="w-full h-12 font-semibold" disabled={!recipientInput.trim() || searching}>
                {searching ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {searching ? 'Validating Recipient...' : 'Find Recipient'}
                {!searching && <ChevronRight className="w-4 h-4 ml-1" />}
              </Button>
            </div>
          </FadeIn>
        )}

        {/* RECIPIENT INFORMATION */}
        {step === 'recipient_info' && recipientDetails && (
          <FadeIn key="recip_info">
            <div className="space-y-5">
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-3">
                  <UserCheck className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-lg font-bold text-foreground">Recipient Validated</h2>
                <p className="text-xs text-muted-foreground">Verify recipient identity before entering amount</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Name</span>
                  <span className="font-semibold text-foreground">{recipientDetails.fullName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" /> Student ID</span>
                  <span className="font-medium text-foreground">{recipientDetails.studentId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</span>
                  <span className="font-medium text-foreground">{recipientDetails.email}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Building className="w-3.5 h-3.5" /> Department</span>
                  <span className="font-medium text-foreground">{recipientDetails.department}</span>
                </div>
                {recipientDetails.batch && recipientDetails.batch !== 'N/A' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> Batch</span>
                    <span className="font-medium text-foreground">{recipientDetails.batch}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('recipient')} className="flex-1 h-12">
                  Change Recipient
                </Button>
                <Button onClick={handleToAmount} className="flex-1 h-12 font-semibold">
                  Enter Amount <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </FadeIn>
        )}

        {/* AMOUNT */}
        {step === 'amount' && recipientDetails && (
          <FadeIn key="amount">
            <div className="space-y-5">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Transferring to</p>
                <p className="font-bold text-foreground text-base">{recipientDetails.fullName}</p>
                <p className="text-xs text-muted-foreground font-mono">{recipientDetails.studentId}</p>
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount (৳)</Label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
                  className="mt-2 text-2xl font-bold h-14 text-center bg-accent/50 border-border/60" min={1} max={50000} autoFocus />
                <p className="text-[11px] text-muted-foreground mt-2 text-center">
                  Wallet PIN and Email OTP verification required for completion.
                </p>
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Note (optional)</Label>
                <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="What's this for?" className="mt-2 bg-accent/50 border-border/60" rows={2} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('recipient_info')} className="flex-1 h-12">
                  Back
                </Button>
                <Button onClick={handleToReview} className="flex-1 h-12 font-semibold" disabled={!amt || amt <= 0}>
                  Review Transfer <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </FadeIn>
        )}

        {/* CONFIRMATION / REVIEW */}
        {step === 'review' && recipientDetails && (
          <FadeIn key="review">
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-foreground text-center">Review Transfer</h2>
              <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Recipient</span><span className="font-semibold text-foreground">{recipientDetails.fullName} ({recipientDetails.studentId})</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount</span><span className="font-bold text-foreground tabular">{formatCurrency(amt)}</span></div>
                {note && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Note</span><span className="font-medium text-foreground truncate max-w-[180px]">{note}</span></div>}
                <div className="border-t border-border/40 pt-3 flex justify-between text-sm">
                  <span className="text-muted-foreground">New Balance</span>
                  <span className="font-bold text-foreground tabular">{formatCurrency((wallet?.balance || 0) - amt)}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('amount')} className="flex-1 h-12">
                  Back
                </Button>
                <Button onClick={handleStartAuth} className="flex-1 h-12 font-semibold">
                  Proceed to Verify PIN <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </FadeIn>
        )}

        {/* PROCESSING */}
        {step === 'processing' && (
          <motion.div key="proc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
              <ArrowRightLeft className="absolute inset-0 m-auto w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Processing Transfer...</p>
            <p className="text-xs text-muted-foreground mt-1">Please wait</p>
          </motion.div>
        )}

        {/* SUCCESS */}
        {step === 'success' && success && (
          <SuccessScreen
            title="Transfer Successful!"
            subtitle={`${formatCurrency(success.amount)} sent to ${success.recipientName}`}
            details={[
              { label: 'Recipient', value: success.recipientName },
              { label: 'Amount', value: formatCurrency(success.amount) },
              { label: 'New Balance', value: formatCurrency(success.newBalance) },
            ]}
            actions={[
              { label: 'New Transfer', onClick: reset, variant: 'outline' },
              { label: 'Raise Dispute', onClick: () => setWizardOpen(true), variant: 'outline' },
              { label: 'Done', onClick: () => navigate('/student') },
            ]}
          />
        )}
      </AnimatePresence>

      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode="verify" verifyLength={user?.pinLength || 4} onSuccess={onPinVerified} />
      <OtpDialog open={otpOpen} onOpenChange={setOtpOpen} purpose="Transfer" onSuccess={onOtpVerified} />
      {success && (
        <DisputeWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          transactionId={success.transactionId}
          transactionSummary={{ reference: success.transactionId, amount: success.amount, type: 'Transfer Sent' }}
        />
      )}
    </div>
  );
}
