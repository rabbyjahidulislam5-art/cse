import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, UserPlus, Gavel, Banknote, Snowflake, Lock, Flag, Store, History,
  User, Hash, Clock, MapPin, Smartphone, CreditCard, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import StatusBadge from '@/components/StatusBadge';
import { FadeIn } from '@/components/PageTransition';
import { formatCurrency } from '@/lib/mock-data';
import {
  getAdminDisputeDetail, assignOfficerAdmin, overrideDispute, approveRefundAdmin, rejectRefundAdmin,
  freezeWallet, lockAccount, flagUser, flagMerchant, DISPUTE_STATUSES, type AccountsDisputeDetail, type DisputeStatus,
} from '@/lib/disputeApi';
import { getAccountsOfficers } from '@/lib/disputeApi';

type Action = null | 'assign' | 'override';

function Field({ icon: Icon, label, value }: { icon?: typeof User; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm py-1">
      <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">{Icon && <Icon className="w-3.5 h-3.5" />} {label}</span>
      <span className="font-medium text-foreground text-right">{value ?? 'N/A'}</span>
    </div>
  );
}

export default function AdminDisputeDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const disputeId = searchParams.get('disputeId') || '';

  const [detail, setDetail] = useState<AccountsDisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [officers, setOfficers] = useState<Array<{ id: string; fullName: string | null }>>([]);
  const [selectValue, setSelectValue] = useState('');
  const [text, setText] = useState('');

  const load = () => {
    if (!disputeId) return;
    setLoading(true);
    getAdminDisputeDetail({ disputeId }).then(setDetail).catch((e: any) => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [disputeId]);
  useEffect(() => { getAccountsOfficers().then(r => setOfficers(r.officers)); }, []);

  const run = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true);
    try { await fn(); toast.success(msg); setAction(null); setSelectValue(''); setText(''); load(); }
    catch (e: any) { toast.error(e.message || 'Action failed.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!detail) return <p className="text-center text-sm text-muted-foreground py-24">Case not found.</p>;

  const { dispute, student, transaction, refunds } = detail;
  const pendingRefund = refunds.find(r => r.status === 'Pending');

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/admin/disputes')} className="p-2 rounded-xl hover:bg-accent transition-colors"><ArrowLeft className="w-5 h-5 text-muted-foreground" /></button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground font-mono">{dispute.caseNumber}</h1>
          <p className="text-xs text-muted-foreground">{dispute.category}</p>
        </div>
        <StatusBadge status={dispute.status} />
      </div>

      <FadeIn>
        <div className="flex flex-wrap gap-1.5 mb-4">
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('assign')}><UserPlus className="w-3.5 h-3.5" /> Assign Officer</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('override')}><Gavel className="w-3.5 h-3.5" /> Override Decision</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => navigate('/admin/shops')}><Store className="w-3.5 h-3.5" /> Manage Shop <ExternalLink className="w-3 h-3" /></Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={busy} onClick={() => run(() => freezeWallet({ userId: student.id, freeze: true, disputeId }), 'Wallet frozen')}><Snowflake className="w-3.5 h-3.5" /> Freeze Wallet</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={busy} onClick={() => run(() => lockAccount({ userId: student.id, lock: student.status !== 'Locked', disputeId }), student.status === 'Locked' ? 'Account unlocked' : 'Account locked')}>
            <Lock className="w-3.5 h-3.5" /> {student.status === 'Locked' ? 'Unlock Account' : 'Lock Account'}
          </Button>
          <Button size="sm" variant="outline" className={`text-xs gap-1.5 ${student.flagged ? 'border-destructive/40 text-destructive' : ''}`} disabled={busy}
            onClick={() => run(() => flagUser({ userId: student.id, flag: !student.flagged, reason: student.flagged ? undefined : 'Flagged from dispute case review', disputeId }), student.flagged ? 'User unflagged' : 'User flagged')}>
            <Flag className="w-3.5 h-3.5" /> {student.flagged ? 'Unflag User' : 'Flag User'}
          </Button>
          {transaction?.receiver?.kind === 'shop' && (
            <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={busy}
              onClick={() => run(() => flagMerchant({ shopId: transaction.receiver!.id, flag: true, disputeId }), 'Merchant flagged')}>
              <Flag className="w-3.5 h-3.5" /> Flag Merchant
            </Button>
          )}
        </div>

        {action && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-4 space-y-3">
            {action === 'assign' && (
              <>
                <p className="text-xs font-semibold text-foreground">Assign Accounts Officer</p>
                <Select value={selectValue} onValueChange={setSelectValue}>
                  <SelectTrigger className="bg-card"><SelectValue placeholder="Select an officer" /></SelectTrigger>
                  <SelectContent>{officers.map(o => <SelectItem key={o.id} value={o.id}>{o.fullName}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setAction(null)}>Cancel</Button>
                  <Button size="sm" disabled={busy || !selectValue} onClick={() => run(() => assignOfficerAdmin({ disputeId, assignedToId: selectValue }), 'Officer assigned')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Assign</Button>
                </div>
              </>
            )}
            {action === 'override' && (
              <>
                <p className="text-xs font-semibold text-foreground">Override Case Status</p>
                <Select value={selectValue} onValueChange={setSelectValue}>
                  <SelectTrigger className="bg-card"><SelectValue placeholder="New status" /></SelectTrigger>
                  <SelectContent>{DISPUTE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Textarea value={text} onChange={e => setText(e.target.value)} className="bg-card min-h-[70px]" placeholder="Reason for override (required, audited)" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setAction(null)}>Cancel</Button>
                  <Button size="sm" disabled={busy || !selectValue || !text.trim()} onClick={() => run(() => overrideDispute({ disputeId, status: selectValue as DisputeStatus, reason: text }), 'Status overridden')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Override</Button>
                </div>
              </>
            )}
          </div>
        )}

        {pendingRefund && (
          <div className="rounded-xl border border-[hsl(var(--chart-4))]/40 bg-[hsl(var(--chart-4))]/5 p-4 mb-4">
            <p className="text-xs font-semibold text-[hsl(var(--chart-4))] uppercase tracking-wide mb-2 flex items-center gap-1.5"><Banknote className="w-3.5 h-3.5" /> High-Value Refund Awaiting Approval</p>
            <p className="text-sm text-foreground mb-3">{pendingRefund.amountType} refund of <strong>{formatCurrency(pendingRefund.amount)}</strong> via {pendingRefund.method}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => run(() => approveRefundAdmin({ refundId: pendingRefund.id }), 'Refund approved and processed')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Approve Refund</Button>
              <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" disabled={busy} onClick={() => run(() => rejectRefundAdmin({ refundId: pendingRefund.id, reason: 'Rejected by Admin' }), 'Refund rejected')}>Reject Refund</Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Student</p>
            <Field label="Name" value={student.fullName} />
            <Field label="Student ID" value={student.studentId} />
            <Field label="Account Status" value={student.status} />
            {student.flagged && <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs"><Flag className="w-3.5 h-3.5" /> Flagged: {student.flagReason}</div>}
          </div>
          {transaction && (
            <div className="rounded-xl border border-border/60 bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" /> Payment</p>
              <Field icon={Hash} label="Reference" value={<span className="font-mono text-xs">{transaction.transaction.reference}</span>} />
              <Field label="Amount" value={formatCurrency(transaction.transaction.amount)} />
              <Field icon={Clock} label="Time" value={new Date(transaction.transaction.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })} />
              <Field icon={MapPin} label="IP" value={transaction.transaction.ipAddress || 'Not recorded'} />
              <Field icon={Smartphone} label="Device" value={transaction.transaction.deviceInfo || 'Not recorded'} />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-accent/20 p-4 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Audit Timeline</p>
          <div className="space-y-2">
            {detail.timeline.map(t => (
              <div key={t.id} className="flex items-start gap-2.5 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <div><span className="text-foreground">{t.summary}</span> <span className="text-muted-foreground ml-1">{new Date(t.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'short', timeStyle: 'short' })}</span></div>
              </div>
            ))}
            {detail.timeline.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
          </div>
        </div>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Conversation (including internal notes)</p>
        <div className="space-y-2.5 mb-4">
          {detail.messages.length === 0 && <p className="text-xs text-muted-foreground italic py-3 text-center">No messages yet.</p>}
          {detail.messages.map(m => (
            <div key={m.id} className={`rounded-xl border p-3.5 ${m.isInternal ? 'border-[hsl(var(--chart-4))]/30 bg-[hsl(var(--chart-4))]/5' : 'border-border/60 bg-card'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-foreground">{m.authorName} {m.authorRole && <span className="text-primary">({m.authorRole})</span>} {m.isInternal && <span className="text-[hsl(var(--chart-4))] ml-1">· Internal</span>}</span>
                <span className="text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line">{m.body}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Security Audit Log</p>
          <div className="space-y-1">
            {detail.auditLogs.map(a => (
              <div key={a.id} className="text-[10px] font-mono text-muted-foreground flex justify-between gap-2">
                <span className="truncate">{a.action} — {a.details}</span>
                <span className="shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
            ))}
            {detail.auditLogs.length === 0 && <p className="text-xs text-muted-foreground">No audit entries yet.</p>}
          </div>
        </div>
      </FadeIn>
    </div>
  );
}
