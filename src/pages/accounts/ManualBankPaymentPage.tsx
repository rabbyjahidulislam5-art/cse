import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Loader2, Landmark, UserRound, ShieldAlert, CheckCircle2, ArrowLeft, Banknote } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  getStudentOutstandingDues, recordManualBankPayment,
  type StudentOutstandingDuesOutputType, type RecordManualPaymentOutputType,
} from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';
import BackButton from '@/components/BackButton';

const SOURCE_TAGS: Record<string, string> = {
  semester: 'Semester Fee', library: 'Library Fine', admin: 'Admin Fine', payLater: 'Shop Due',
};

type Step = 'search' | 'review' | 'success';

// Offline bank-payment settlement — a student who paid manually at a bank brings the receipt
// here. Accounts Office looks the student up, verifies the receipt, and records it; the backend
// runs the exact same Unified Outstanding Due Settlement an online payment triggers (every
// pending due across every source, atomically), just without a wallet debit. If the student was
// financially restricted, settling clears it automatically — no separate "reactivate" step.
export default function ManualBankPaymentPage() {
  const [step, setStep] = useState<Step>('search');
  const [studentIdInput, setStudentIdInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<StudentOutstandingDuesOutputType | null>(null);

  const [bankReference, setBankReference] = useState('');
  const [amountReceived, setAmountReceived] = useState('');
  const [note, setNote] = useState('');
  const [recording, setRecording] = useState(false);
  const [successInfo, setSuccessInfo] = useState<RecordManualPaymentOutputType | null>(null);

  const reset = () => {
    setStep('search'); setStudentIdInput(''); setResult(null);
    setBankReference(''); setAmountReceived(''); setNote(''); setSuccessInfo(null);
  };

  const handleSearch = async () => {
    const id = studentIdInput.trim();
    if (!id) { toast.error('Enter a Student ID.'); return; }
    setSearching(true);
    try {
      const res = await getStudentOutstandingDues({ studentId: id });
      if (!res.items.length || res.total <= 0) {
        toast.info(`${res.student?.fullName || 'This student'} has no outstanding dues.`);
        setResult(res);
        return;
      }
      setResult(res);
      setAmountReceived(String(res.total));
      setStep('review');
    } catch (e: any) {
      toast.error(e.message || 'Student not found.');
    } finally {
      setSearching(false);
    }
  };

  const handleRecord = async () => {
    if (!result) return;
    const amount = parseFloat(amountReceived);
    if (!bankReference.trim() || bankReference.trim().length < 3) { toast.error('Enter the bank receipt / reference number.'); return; }
    if (!amount || amount < result.total) { toast.error(`Amount received must be at least ${formatCurrency(result.total)}.`); return; }

    setRecording(true);
    try {
      const res = await recordManualBankPayment({
        studentId: result.student.studentId, bankReference: bankReference.trim(),
        amountReceived: amount, note: note.trim() || undefined,
      });
      setSuccessInfo(res);
      setStep('success');
      toast.success('Payment recorded and settled.');
    } catch (e: any) {
      toast.error(e.message || 'Failed to record payment.');
    } finally {
      setRecording(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <FadeIn>
        <BackButton fallback="/accounts" />
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-xl bg-[hsl(var(--chart-4))]/15 border border-[hsl(var(--chart-4))]/20 flex items-center justify-center text-[hsl(var(--chart-4))]">
            <Banknote className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Offline Bank Payment</h1>

          </div>
        </div>
      </FadeIn>

      {step === 'search' && (
        <FadeIn>
          <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Student ID</Label>
              <Input
                value={studentIdInput}
                onChange={(e) => setStudentIdInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="e.g. 2021-1-60-001"
                className="h-12 rounded-xl bg-accent/30 border-border/60 focus:border-primary font-medium"
                disabled={searching}
                maxLength={40}
              />
            </div>
            <Button onClick={handleSearch} disabled={searching || !studentIdInput.trim()} className="w-full rounded-xl font-semibold gap-2">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {searching ? 'Searching...' : 'Find Student'}
            </Button>
          </div>
        </FadeIn>
      )}

      {step === 'review' && result?.student && (
        <FadeIn>
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <UserRound className="w-3.5 h-3.5" /> Student
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-semibold text-foreground text-right">{result.student.fullName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Student ID</span>
                <span className="font-medium text-foreground">{result.student.studentId}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Department / Batch</span>
                <span className="font-medium text-foreground">{result.student.department || 'N/A'} / {result.student.batch || 'N/A'}</span>
              </div>
              {result.restricted && (
                <div className="flex items-center gap-2 mt-1 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive font-medium">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>Financially restricted — settling this will reactivate the account.</span>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wide">
                <Landmark className="w-3.5 h-3.5" /> Outstanding Dues
              </div>
              {result.items.map((item, idx) => (
                <div key={idx} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{SOURCE_TAGS[item.source] || item.source}{item.label ? ` — ${item.label}` : ''}</span>
                  <span className="font-medium text-foreground shrink-0 ml-3">{formatCurrency(item.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm pt-2 border-t border-primary/10">
                <span className="font-semibold text-foreground">Total Payable</span>
                <span className="font-bold text-foreground tabular text-base">{formatCurrency(result.total)}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Bank Receipt / Reference Number</Label>
                <Input value={bankReference} onChange={(e) => setBankReference(e.target.value)} placeholder="e.g. bank slip / transaction number" className="h-11 rounded-xl bg-accent/30 border-border/60 font-mono" disabled={recording} />
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Amount Received (৳)</Label>
                <Input type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} min={result.total} className="h-11 rounded-xl bg-accent/30 border-border/60" disabled={recording} />

              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Note (optional)</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="rounded-xl bg-accent/30 border-border/60" disabled={recording} />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('search')} disabled={recording} className="rounded-xl gap-1.5">
                  <ArrowLeft className="w-4 h-4" /> Back
                </Button>
                <Button onClick={handleRecord} disabled={recording} className="flex-1 rounded-xl font-semibold gap-2">
                  {recording ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
                  {recording ? 'Recording...' : `Record & Settle ${formatCurrency(result.total)}`}
                </Button>
              </div>
            </div>
          </div>
        </FadeIn>
      )}

      {step === 'success' && successInfo && (
        <FadeIn>
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-center space-y-4">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mx-auto w-16 h-16 rounded-2xl bg-[hsl(var(--chart-3))]/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-[hsl(var(--chart-3))]" />
            </motion.div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Payment Recorded</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {successInfo.wasRestricted ? `${successInfo.studentName}'s account has been reactivated.` : `Settled for ${successInfo.studentName}.`}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-2 text-left">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount</span><span className="font-bold text-foreground tabular">{formatCurrency(successInfo.amount)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Reference</span><span className="font-mono text-xs text-foreground">{successInfo.reference}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Items Settled</span><span className="font-medium text-foreground">{successInfo.items.length}</span></div>
            </div>
            <Button onClick={reset} className="w-full rounded-xl font-semibold">Record Another Payment</Button>
          </div>
        </FadeIn>
      )}
    </div>
  );
}
