import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, User, Users, Store, CreditCard, Wallet, Clock, MapPin, Smartphone,
  Hash, Download, ExternalLink, ScrollText, AlertOctagon, ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import StatusBadge from '@/components/StatusBadge';
import { getTransactionDetail, type TransactionDetail } from '@/lib/disputeApi';
import { getReceipt } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import { triggerDownload } from '@/lib/download';

function Row({ icon: Icon, label, value, mono }: { icon?: typeof User; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm py-1.5">
      <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </span>
      <span className={`font-medium text-foreground text-right ${mono ? 'font-mono text-xs' : ''}`}>{value ?? 'N/A'}</span>
    </div>
  );
}

interface TransactionDetailCardProps {
  transactionId: string;
  onRaiseDispute?: (detail: TransactionDetail) => void;
  disableDispute?: boolean;
}

export default function TransactionDetailCard({ transactionId, onRaiseDispute, disableDispute }: TransactionDetailCardProps) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTransactionDetail({ transactionId })
      .then(d => { if (!cancelled) setDetail(d); })
      .catch((e: any) => toast.error(e.message || 'Failed to load transaction details.'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [transactionId]);

  const handleReceipt = async (openAfter: boolean) => {
    setReceiptLoading(true);
    try {
      const url = receiptUrl || (await getReceipt({ transactionId })).url;
      setReceiptUrl(url);
      if (openAfter) triggerDownload(url);
    } catch (e: any) {
      toast.error(e.message || 'Could not generate receipt.');
    } finally {
      setReceiptLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!detail) {
    return <p className="text-sm text-muted-foreground text-center py-6">Could not load transaction details.</p>;
  }

  const { transaction: tx, sender, receiver, gateway, dispute, destination } = detail;
  const isCredit = tx.direction === 'Credit';

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="rounded-xl border border-border/60 bg-accent/20 p-4 space-y-4 mt-2">
        {/* Amount + status header */}
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div>
            <div className={`text-xl font-bold tabular ${isCredit ? 'text-[hsl(var(--chart-3))]' : 'text-foreground'}`}>
              {isCredit ? '+' : '−'}{formatCurrency(tx.amount)}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{tx.type}{tx.paymentMethod ? ` · ${tx.paymentMethod}` : ''}</div>
          </div>
          <StatusBadge status={tx.status} />
        </div>

        {/* Core identifiers */}
        <div className="space-y-0.5">
          <Row icon={Hash} label="Transaction ID" value={tx.id} mono />
          <Row icon={Hash} label="Reference Number" value={tx.reference} mono />
          {gateway?.validationId && <Row icon={ShieldCheck} label="Gateway Validation ID" value={gateway.validationId} mono />}
          {gateway?.bankTranId && <Row icon={Hash} label="Bank Transaction ID" value={gateway.bankTranId} mono />}
        </div>

        <div className="h-px bg-border/40" />

        {/* Parties */}
        <div className="space-y-0.5">
          <Row icon={User} label="Sender" value={sender?.name || (isCredit ? 'N/A' : 'You')} />
          <Row
            icon={receiver?.kind === 'shop' ? Store : Users}
            label="Receiver"
            value={receiver?.name ?? destination?.label}
          />
          {receiver?.role && <Row label="Receiver Role" value={receiver.role} />}
          {receiver?.department && <Row label="Receiver Department" value={receiver.department} />}
        </div>

        <div className="h-px bg-border/40" />

        {/* Payment method / gateway */}
        <div className="space-y-0.5">
          <Row icon={CreditCard} label="Payment Source" value={tx.purpose ? tx.purpose.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : tx.type} />
          <Row icon={CreditCard} label="Gateway" value={gateway?.provider || tx.paymentMethod || 'N/A'} />
          {gateway?.confirmedVia && <Row label="Confirmed Via" value={gateway.confirmedVia === 'ipn' ? 'Server IPN' : 'Browser Validation'} />}
        </div>

        {(tx.balanceBefore !== null || tx.balanceAfter !== null) && (
          <>
            <div className="h-px bg-border/40" />
            <div className="space-y-0.5">
              <Row icon={Wallet} label="Wallet Balance Before" value={tx.balanceBefore !== null ? formatCurrency(tx.balanceBefore) : 'Not recorded'} />
              <Row icon={Wallet} label="Wallet Balance After" value={tx.balanceAfter !== null ? formatCurrency(tx.balanceAfter) : 'Not recorded'} />
            </div>
          </>
        )}

        <div className="h-px bg-border/40" />

        {/* Audit context */}
        <div className="space-y-0.5">
          <Row icon={Clock} label="Time" value={new Date(tx.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' })} />
          <Row icon={MapPin} label="IP Address" value={tx.ipAddress || 'Not recorded'} mono={!!tx.ipAddress} />
          <Row icon={Smartphone} label="Device" value={tx.deviceInfo ? tx.deviceInfo.slice(0, 60) : 'Not recorded'} />
        </div>

        {dispute && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[hsl(var(--chart-4))]/10 border border-[hsl(var(--chart-4))]/20 text-xs font-medium">
            <AlertOctagon className="w-4 h-4 shrink-0 text-[hsl(var(--chart-4))]" />
            <span className="flex-1">Dispute <strong className="font-mono">{dispute.caseNumber}</strong> is {dispute.status.toLowerCase()} for this transaction.</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" className="w-full sm:w-auto rounded-lg gap-1.5 text-xs" disabled={receiptLoading} onClick={() => handleReceipt(false)}>
            {receiptLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download Receipt
          </Button>
          <Button variant="outline" size="sm" className="w-full sm:w-auto rounded-lg gap-1.5 text-xs" disabled={receiptLoading} onClick={() => handleReceipt(true)}>
            <ExternalLink className="w-3.5 h-3.5" /> Print Receipt
          </Button>
          {tx.status === 'Success' && !dispute && !disableDispute && onRaiseDispute && (
            <Button size="sm" className="w-full sm:w-auto rounded-lg gap-1.5 text-xs sm:ml-auto" onClick={() => onRaiseDispute(detail)}>
              <ScrollText className="w-3.5 h-3.5" /> Raise Dispute
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
