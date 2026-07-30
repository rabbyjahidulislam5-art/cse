import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Shield, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/mock-data';

export interface PaymentConfirmLineItem {
  label: string;
  amount: number;
}

interface PaymentConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiverName: string;
  receiverRole?: string;
  payerName?: string;
  amount: number;
  lineItems?: PaymentConfirmLineItem[];
  method?: string;
  onConfirm: () => void;
  confirmLabel?: string;
  loading?: boolean;
}

// Shared confirmation step for every payment entry point (Dues single/mass pay, Shop payment,
// QR-scan payment) so every payment shows the same receiver/amount/method/warning in the same
// shape before redirecting to the payment gateway.
export default function PaymentConfirmModal({
  open, onOpenChange, receiverName, receiverRole, payerName, amount, lineItems, method = 'Secure Online Payment', onConfirm, confirmLabel = 'Confirm & Pay', loading,
}: PaymentConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md glass-strong rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Shield className="w-4.5 h-4.5 text-primary" /> Review Payment</DialogTitle>
          <DialogDescription>Confirm the details before you're redirected to the payment gateway.</DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-3">
          <div className="flex justify-between text-sm gap-3">
            <span className="text-muted-foreground shrink-0">Receiver</span>
            <span className="font-semibold text-foreground text-right">{receiverName}{receiverRole ? ` (${receiverRole})` : ''}</span>
          </div>
          {payerName && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Paying as</span>
              <span className="font-medium text-foreground">{payerName}</span>
            </div>
          )}
          {lineItems && lineItems.length > 1 && (
            <div className="space-y-1.5 pt-2 border-t border-border/40">
              {lineItems.map((li, i) => (
                <div key={i} className="flex justify-between text-xs gap-3">
                  <span className="text-muted-foreground truncate">{li.label}</span>
                  <span className="text-foreground tabular shrink-0">{formatCurrency(li.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between text-sm pt-2 border-t border-border/40">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-bold text-foreground tabular text-base">{formatCurrency(amount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Method</span>
            <span className="font-medium text-foreground">{method}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Date</span>
            <span className="font-medium text-foreground">
              {new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-destructive/5 border border-destructive/15 p-3 rounded-xl">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <span>This payment is processed securely and cannot be reversed automatically once completed.</span>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={onConfirm} disabled={loading} className="font-semibold">
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {loading ? 'Redirecting...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
