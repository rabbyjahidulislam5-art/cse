import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GraduationCap, Search, CreditCard, Loader2, ArrowRight, ArrowLeft, CheckCircle2, UserRound, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { lookupSemesterFeeStudent, paySemesterFee, type SemesterFeeLookupOutputType } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import { useUser } from '@/lib/user-context';
import { getStoredToken, getStoredUser, setStoredToken, setStoredUser } from '@/lib/auth-storage';

interface SemesterFeeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'search' | 'review' | 'success';

export default function SemesterFeeModal({ open, onOpenChange }: SemesterFeeModalProps) {
  const { user, wallet, refreshDashboard } = useUser();
  const [step, setStep] = useState<Step>('search');
  const [studentIdInput, setStudentIdInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SemesterFeeLookupOutputType | null>(null);
  const [method, setMethod] = useState<'wallet' | 'sslcommerz'>('wallet');
  const [paying, setPaying] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [validatedOtpId, setValidatedOtpId] = useState<string | undefined>(undefined);
  const [successInfo, setSuccessInfo] = useState<{ amount: number; studentName: string; paidByName: string; reference?: string } | null>(null);

  useEffect(() => {
    if (open) {
      setStep('search');
      setResult(null);
      setSearching(false);
      setPaying(false);
      setValidatedOtpId(undefined);
      setSuccessInfo(null);
      // Defaults to the logged-in student's own ID — the common case — but stays fully editable
      // so the same flow covers paying on someone else's behalf.
      setStudentIdInput(user?.studentId || '');
    }
  }, [open, user?.studentId]);

  const totalDue = result?.totalDue || 0;
  const isOnBehalf = !!result?.student && !!user?.studentId && result.student.studentId !== user.studentId;
  const walletBalance = wallet?.balance || 0;
  const insufficientWallet = walletBalance < totalDue;

  const handleSearch = async () => {
    const id = studentIdInput.trim();
    if (!id) { toast.error('Enter a Student ID.'); return; }
    setSearching(true);
    try {
      const res = await lookupSemesterFeeStudent({ studentId: id });
      if (!res.totalDue || res.totalDue <= 0) {
        toast.info(`No pending semester fees found for ${res.student?.fullName || 'this student'}.`);
        setResult(res);
        return;
      }
      setResult(res);
      setStep('review');
    } catch (e: any) {
      toast.error(e.message || 'Student not found.');
    } finally {
      setSearching(false);
    }
  };

  const handleInitiatePay = () => {
    if (!result?.student || totalDue <= 0) return;
    if (insufficientWallet) {
      toast.error('Insufficient Wallet Balance.');
      return;
    }
    executePay();
  };

  const executePay = async () => {
    if (!result?.student) return;
    setPaying(true);
    try {
      const res = await paySemesterFee({ studentId: result.student.studentId, method: 'sslcommerz' });
      if (res.gatewayUrl) {
        const currentToken = getStoredToken();
        const currentUser = getStoredUser();
        if (currentToken) setStoredToken(currentToken);
        if (currentUser) setStoredUser(currentUser);
        localStorage.setItem('ssl_payment', JSON.stringify({ ref: res.transactionRef }));
        toast.success('Redirecting to SSLCOMMERZ...');
        window.location.href = res.gatewayUrl;
        return;
      }
      setSuccessInfo({
        amount: res.amount,
        studentName: res.studentName || result.student.fullName,
        paidByName: res.paidByName || user?.fullName || 'You',
        reference: res.reference,
      });
      setStep('success');
      refreshDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Payment failed.');
      setPaying(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !paying && !searching && onOpenChange(v)}>
        <DialogContent className="sm:max-w-md glass-strong rounded-2xl p-6">
          {step === 'search' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
                  <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center text-primary">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  Pay Semester Fee
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  Look up a Student ID to view and pay a pending semester fee — yours or someone else's.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 my-2">
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Student ID
                  </Label>
                  <Input
                    value={studentIdInput}
                    onChange={(e) => setStudentIdInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                    placeholder="e.g. 2021-1-60-001"
                    className="h-12 rounded-xl bg-card border-border/60 focus:border-primary font-medium"
                    disabled={searching}
                    maxLength={40}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Defaults to your own ID — enter another student's ID to pay on their behalf.
                  </p>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={searching} className="rounded-xl">
                  Cancel
                </Button>
                <Button onClick={handleSearch} disabled={searching || !studentIdInput.trim()} className="rounded-xl font-semibold gap-2">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {searching ? 'Searching...' : 'Find Student'}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 'review' && result?.student && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
                  <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center text-primary">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  Confirm Payment
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 my-2">
                <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-2.5">
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
                    <span className="text-muted-foreground">Department</span>
                    <span className="font-medium text-foreground">{result.student.department || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Batch</span>
                    <span className="font-medium text-foreground">{result.student.batch || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-border/40">
                    <span className="text-muted-foreground">Total Due</span>
                    <span className="font-bold text-foreground tabular text-base">{formatCurrency(totalDue)}</span>
                  </div>
                </div>

                {isOnBehalf && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-secondary/10 border border-secondary/20 text-xs text-secondary font-medium">
                    <UserRound className="w-4 h-4 shrink-0" />
                    <span>You're paying on behalf of this student, as <strong>{user?.fullName}</strong>.</span>
                  </div>
                )}

                <div>
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                    Payment Method
                  </Label>
                  <div className="p-3.5 rounded-xl border border-primary/40 bg-primary/5 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-bold text-foreground">
                        <CreditCard className="w-4 h-4 text-primary" /> SSLCOMMERZ Hosted Payment
                      </span>
                      <span className="text-[10px] font-semibold text-muted-foreground">Bal: {formatCurrency(walletBalance)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Payment will be completed using your Smart Campus Wallet through the SSLCOMMERZ secure gateway.
                    </p>
                  </div>
                  {insufficientWallet && (
                    <div className="flex items-center gap-2 mt-2.5 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive font-medium">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Insufficient Wallet Balance.</span>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setStep('search')} disabled={paying} className="rounded-xl gap-1.5">
                  <ArrowLeft className="w-4 h-4" /> Back
                </Button>
                <Button
                  onClick={handleInitiatePay}
                  disabled={paying || insufficientWallet}
                  className="rounded-xl font-semibold gap-2"
                >
                  {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {paying ? 'Processing...' : `Pay ${formatCurrency(totalDue)}`}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 'success' && successInfo && (
            <>
              <DialogHeader className="text-center">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-[hsl(var(--chart-3))]/10 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-8 h-8 text-[hsl(var(--chart-3))]" />
                </div>
                <DialogTitle className="text-lg font-bold text-center">Payment Complete</DialogTitle>
                <DialogDescription className="text-sm text-center">
                  Paid by: <strong className="text-foreground">{successInfo.paidByName}</strong>
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-2.5 my-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Student</span>
                  <span className="font-semibold text-foreground">{successInfo.studentName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-bold text-foreground tabular">{formatCurrency(successInfo.amount)}</span>
                </div>
                {successInfo.reference && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Reference</span>
                    <span className="font-mono text-xs text-foreground">{successInfo.reference}</span>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button onClick={() => onOpenChange(false)} className="w-full rounded-xl font-semibold">
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
