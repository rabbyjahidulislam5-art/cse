import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Loader2, CheckCircle2, Smartphone } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { requestWithdrawal } from '@/lib/api';
import { useUser } from '@/lib/user-context';
import { formatCurrency } from '@/lib/mock-data';
import { motion } from 'framer-motion';

export default function WithdrawPage() {
  const navigate = useNavigate();
  const { wallet, refreshDashboard } = useUser();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const amt = parseFloat(amount) || 0;
  const balance = wallet?.balance || 0;
  const canSubmit = amt >= 100 && amt <= balance && method && accountNumber.length >= 5 && accountName.length >= 2;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await requestWithdrawal({
        amount: amt,
        method: method as any,
        accountNumber,
        accountName,
      });
      toast.success(res.message);
      setSuccess(true);
      refreshDashboard();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  if (success) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-lg">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-16">
          <div className="w-20 h-20 rounded-full bg-[hsl(var(--chart-3))]/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-[hsl(var(--chart-3))]" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Withdrawal Requested</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Your withdrawal of {formatCurrency(amt)} via {method} has been submitted. The Accounts Office will review and process it.
          </p>
          <div className="mt-4 p-4 rounded-xl border border-border/60 bg-card">
            <p className="text-xs text-muted-foreground">New Wallet Balance</p>
            <p className="text-xl font-bold text-foreground tabular">{formatCurrency(balance - amt)}</p>
          </div>
          <div className="flex gap-3 mt-8 justify-center">
            <Button variant="outline" onClick={() => navigate('/student/ledger')}>View Ledger</Button>
            <Button onClick={() => navigate('/student')}>Dashboard</Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-foreground">Withdraw Funds</h1>
          <p className="text-xs text-muted-foreground">Transfer to your mobile wallet or bank</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-5 mb-6">
        <p className="text-xs text-muted-foreground">Available Balance</p>
        <p className="text-2xl font-bold text-foreground tabular">{formatCurrency(balance)}</p>
      </div>

      <div className="space-y-5">
        <div>
          <Label className="text-xs text-muted-foreground">Amount (৳) *</Label>
          <Input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="Minimum ৳100" className="mt-1.5 text-lg font-bold h-12 bg-accent/50 border-border/60" min={100} max={balance} />
          {amt > 0 && amt < 100 && <p className="text-xs text-destructive mt-1">Minimum withdrawal is ৳100</p>}
          {amt > balance && <p className="text-xs text-destructive mt-1">Exceeds available balance</p>}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Withdrawal Method *</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="mt-1.5 bg-accent/50 border-border/60"><SelectValue placeholder="Select method" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bKash">bKash</SelectItem>
              <SelectItem value="Nagad">Nagad</SelectItem>
              <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            {method === 'Bank Transfer' ? 'Account Number' : 'Mobile Number'} *
          </Label>
          <Input value={accountNumber} onChange={e => setAccountNumber(e.target.value)}
            placeholder={method === 'Bank Transfer' ? 'Enter account number' : 'e.g. 01XXXXXXXXX'}
            className="mt-1.5 bg-accent/50 border-border/60" />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Account Holder Name *</Label>
          <Input value={accountName} onChange={e => setAccountName(e.target.value)}
            placeholder="As registered with the provider" className="mt-1.5 bg-accent/50 border-border/60" />
        </div>

        <div className="flex items-center gap-2 p-3 rounded-xl bg-accent/30 text-xs text-muted-foreground">
          <Smartphone className="w-4 h-4 text-primary shrink-0" />
          <span>Amount will be held immediately. Accounts Office will verify and process within 1-2 business days.</span>
        </div>

        <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="w-full h-12 font-semibold">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Banknote className="w-4 h-4 mr-2" />}
          {submitting ? 'Submitting...' : `Withdraw ${amt > 0 ? formatCurrency(amt) : ''}`}
        </Button>
      </div>
    </div>
  );
}
