import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Loader2, Send, UserPlus, StickyNote, FileText, Snowflake, Forward as ForwardIcon,
  ArrowUpCircle, Banknote, GitMerge, Split, CheckCircle2, XCircle, History, Shield, AlertTriangle,
  Hash, MapPin, Smartphone, Clock, CreditCard, User, Flag, Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import StatusBadge from '@/components/StatusBadge';
import { FadeIn } from '@/components/PageTransition';
import { formatCurrency } from '@/lib/mock-data';
import {
  getAccountsDisputeDetail, getAccountsOfficers, assignDispute, replyToAccountsDispute, requestDocuments,
  freezeDispute, unfreezeDispute, forwardDispute, escalateDispute, resolveDispute, rejectDispute,
  initiateRefund, rejectRefund, mergeDisputes, splitDispute, closeAccountsDispute, DISPUTE_CATEGORIES,
  getDisputePdf, type AccountsDisputeDetail, type RefundMethod,
} from '@/lib/disputeApi';
import { triggerDownload } from '@/lib/download';

type Action = null | 'assign' | 'reply' | 'note' | 'docs' | 'forward' | 'escalate' | 'refund' | 'reject-refund' | 'merge' | 'split' | 'resolve' | 'reject';

const TERMINAL = ['Resolved', 'Rejected', 'Refunded', 'Closed'];

function Field({ icon: Icon, label, value }: { icon?: typeof User; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm py-1">
      <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">{Icon && <Icon className="w-3.5 h-3.5" />} {label}</span>
      <span className="font-medium text-foreground text-right">{value ?? 'N/A'}</span>
    </div>
  );
}

export default function DisputeCaseDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const disputeId = searchParams.get('disputeId') || '';

  const [detail, setDetail] = useState<AccountsDisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [officers, setOfficers] = useState<Array<{ id: string; fullName: string | null }>>([]);

  // Form fields shared across action panels
  const [text, setText] = useState('');
  const [selectValue, setSelectValue] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('WalletCredit');
  const [refundAmountType, setRefundAmountType] = useState<'Full' | 'Partial'>('Full');
  const [refundAmount, setRefundAmount] = useState('');
  const [splitCategory, setSplitCategory] = useState<string>(DISPUTE_CATEGORIES[0]);

  const load = () => {
    if (!disputeId) return;
    setLoading(true);
    getAccountsDisputeDetail({ disputeId }).then(setDetail).catch((e: any) => toast.error(e.message)).finally(() => setLoading(false));
  };

  useEffect(load, [disputeId]);
  useEffect(() => { getAccountsOfficers().then(r => setOfficers(r.officers)); }, []);

  const resetAction = () => { setAction(null); setText(''); setSelectValue(''); setRefundAmount(''); };

  const handlePdf = async () => {
    setPdfLoading(true);
    try {
      const { url } = await getDisputePdf({ disputeId });
      triggerDownload(url);
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  const run = async (fn: () => Promise<any>, successMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(successMsg);
      resetAction();
      load();
    } catch (e: any) {
      toast.error(e.message || 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!detail) return <p className="text-center text-sm text-muted-foreground py-24">Case not found.</p>;

  const { dispute, student, transaction, messages, timeline, statusHistory, refunds, assignments, auditLogs, previousCases, relatedTransactions, risk } = detail;
  const isTerminal = TERMINAL.includes(dispute.status);
  const hasActiveRefund = refunds.some(r => r.status === 'Pending' || r.status === 'Processed');

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/accounts/disputes')} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground font-mono">{dispute.caseNumber}</h1>
          <p className="text-xs text-muted-foreground">{dispute.category}</p>
        </div>
        <StatusBadge status={dispute.status} />
        {dispute.priority === 'High' && <span className="text-[10px] font-bold uppercase text-destructive px-2 py-1 rounded-full bg-destructive/10">High Priority</span>}
        {dispute.frozen && <Snowflake className="w-4 h-4 text-secondary" />}
      </div>

      <FadeIn>
        {/* Action toolbar */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={pdfLoading} onClick={handlePdf}>
            {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download PDF
          </Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('assign')}><UserPlus className="w-3.5 h-3.5" /> Assign</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('reply')} disabled={isTerminal}><Send className="w-3.5 h-3.5" /> Reply</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('note')}><StickyNote className="w-3.5 h-3.5" /> Internal Note</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('docs')} disabled={isTerminal}><FileText className="w-3.5 h-3.5" /> Request Docs</Button>
          {dispute.frozen ? (
            <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={busy} onClick={() => run(() => unfreezeDispute({ disputeId }), 'Case unfrozen')}><Snowflake className="w-3.5 h-3.5" /> Unfreeze</Button>
          ) : (
            <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={busy} onClick={() => run(() => freezeDispute({ disputeId }), 'Case frozen — SLA paused')}><Snowflake className="w-3.5 h-3.5" /> Freeze</Button>
          )}
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('forward')} disabled={isTerminal}><ForwardIcon className="w-3.5 h-3.5" /> Forward</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('escalate')} disabled={isTerminal}><ArrowUpCircle className="w-3.5 h-3.5" /> Escalate</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5 border-[hsl(var(--chart-3))]/40 text-[hsl(var(--chart-3))]" onClick={() => setAction('refund')} disabled={isTerminal || hasActiveRefund}><Banknote className="w-3.5 h-3.5" /> Refund</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('merge')} disabled={isTerminal}><GitMerge className="w-3.5 h-3.5" /> Merge</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAction('split')}><Split className="w-3.5 h-3.5" /> Split</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5 border-[hsl(var(--chart-3))]/40 text-[hsl(var(--chart-3))]" onClick={() => setAction('resolve')} disabled={isTerminal}><CheckCircle2 className="w-3.5 h-3.5" /> Resolve</Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5 border-destructive/40 text-destructive" onClick={() => setAction('reject')} disabled={isTerminal}><XCircle className="w-3.5 h-3.5" /> Reject</Button>
          {!isTerminal && dispute.status !== 'Open' && ['Resolved', 'Rejected', 'Refunded'].includes(dispute.status) && (
            <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={busy} onClick={() => run(() => closeAccountsDispute({ disputeId }), 'Case closed')}>Close</Button>
          )}
        </div>

        {/* Inline action panel */}
        {action && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-4 space-y-3">
            {action === 'assign' && (
              <>
                <p className="text-xs font-semibold text-foreground">Assign Case</p>
                <Select value={selectValue} onValueChange={setSelectValue}>
                  <SelectTrigger className="bg-card"><SelectValue placeholder="Select an officer" /></SelectTrigger>
                  <SelectContent>{officers.map(o => <SelectItem key={o.id} value={o.id}>{o.fullName}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy || !selectValue} className="gap-1.5" onClick={() => run(() => assignDispute({ disputeId, assignedToId: selectValue }), 'Case assigned')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Assign</Button>
                </div>
              </>
            )}
            {(action === 'reply' || action === 'note') && (
              <>
                <p className="text-xs font-semibold text-foreground">{action === 'reply' ? 'Reply to Student' : 'Internal Note (staff-only)'}</p>
                <Textarea value={text} onChange={e => setText(e.target.value)} className="bg-card min-h-[90px]" placeholder="Type here..." />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy || !text.trim()} className="gap-1.5" onClick={() => run(() => replyToAccountsDispute({ disputeId, body: text, isInternal: action === 'note' }), action === 'note' ? 'Note added' : 'Reply sent')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Send</Button>
                </div>
              </>
            )}
            {action === 'docs' && (
              <>
                <p className="text-xs font-semibold text-foreground">Request Documents</p>
                <Textarea value={text} onChange={e => setText(e.target.value)} className="bg-card min-h-[80px]" placeholder="e.g. screenshot of the transaction, receipt photo..." />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy || !text.trim()} className="gap-1.5" onClick={() => run(() => requestDocuments({ disputeId, details: text }), 'Documents requested')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Send Request</Button>
                </div>
              </>
            )}
            {action === 'forward' && (
              <>
                <p className="text-xs font-semibold text-foreground">Forward Case</p>
                <Select value={selectValue} onValueChange={setSelectValue}>
                  <SelectTrigger className="bg-card"><SelectValue placeholder="Forward to..." /></SelectTrigger>
                  <SelectContent><SelectItem value="Shop">Shop</SelectItem><SelectItem value="Library">Library</SelectItem><SelectItem value="Admin">Admin</SelectItem></SelectContent>
                </Select>
                <Textarea value={text} onChange={e => setText(e.target.value)} className="bg-card min-h-[60px]" placeholder="Note (optional)" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy || !selectValue} className="gap-1.5" onClick={() => run(() => forwardDispute({ disputeId, to: selectValue as any, note: text }), 'Case forwarded')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Forward</Button>
                </div>
              </>
            )}
            {action === 'escalate' && (
              <>
                <p className="text-xs font-semibold text-foreground">Escalate to Admin</p>
                <Textarea value={text} onChange={e => setText(e.target.value)} className="bg-card min-h-[70px]" placeholder="Reason for escalation" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy} className="gap-1.5" onClick={() => run(() => escalateDispute({ disputeId, reason: text }), 'Case escalated')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Escalate</Button>
                </div>
              </>
            )}
            {action === 'refund' && transaction && (
              <>
                <p className="text-xs font-semibold text-foreground">Initiate Refund</p>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={refundMethod} onValueChange={v => setRefundMethod(v as RefundMethod)}>
                    <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WalletCredit">Refund to Wallet</SelectItem>
                      <SelectItem value="OriginalPayment">Refund to Original Payment</SelectItem>
                      <SelectItem value="ManualAdjustment">Manual Adjustment</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={refundAmountType} onValueChange={v => setRefundAmountType(v as 'Full' | 'Partial')}>
                    <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Full">Full Refund</SelectItem><SelectItem value="Partial">Partial Refund</SelectItem></SelectContent>
                  </Select>
                </div>
                {refundAmountType === 'Partial' && (
                  <Input type="number" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} placeholder={`Max ৳${transaction.transaction.amount}`} className="bg-card" />
                )}
                <p className="text-[11px] text-muted-foreground">Full amount: {formatCurrency(transaction.transaction.amount)}. Refunds ≥ ৳20,000 require Admin approval before processing.</p>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy || (refundAmountType === 'Partial' && !refundAmount)} className="gap-1.5"
                    onClick={() => run(() => initiateRefund({ disputeId, method: refundMethod, amountType: refundAmountType, amount: refundAmountType === 'Partial' ? Number(refundAmount) : undefined }), 'Refund initiated')}>
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Initiate Refund
                  </Button>
                </div>
              </>
            )}
            {action === 'merge' && (
              <>
                <p className="text-xs font-semibold text-foreground">Merge into another case</p>
                <Input value={text} onChange={e => setText(e.target.value)} placeholder="Target dispute ID" className="bg-card" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy || !text.trim()} className="gap-1.5" onClick={() => run(() => mergeDisputes({ sourceDisputeId: disputeId, targetDisputeId: text.trim() }), 'Cases merged')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Merge</Button>
                </div>
              </>
            )}
            {action === 'split' && (
              <>
                <p className="text-xs font-semibold text-foreground">Split into a new case</p>
                <Select value={splitCategory} onValueChange={setSplitCategory}>
                  <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>{DISPUTE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Textarea value={text} onChange={e => setText(e.target.value)} className="bg-card min-h-[70px]" placeholder="Description for the new case" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy} className="gap-1.5" onClick={() => run(() => splitDispute({ disputeId, category: splitCategory, description: text }), 'New case created')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Split</Button>
                </div>
              </>
            )}
            {action === 'resolve' && (
              <>
                <p className="text-xs font-semibold text-foreground">Resolve Case (no refund)</p>
                <Textarea value={text} onChange={e => setText(e.target.value)} className="bg-card min-h-[80px]" placeholder="Resolution note, visible to the student" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" disabled={busy || !text.trim()} className="gap-1.5" onClick={() => run(() => resolveDispute({ disputeId, resolutionNote: text }), 'Case resolved')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Resolve</Button>
                </div>
              </>
            )}
            {action === 'reject' && (
              <>
                <p className="text-xs font-semibold text-foreground">Reject Case</p>
                <Textarea value={text} onChange={e => setText(e.target.value)} className="bg-card min-h-[80px]" placeholder="Reason, visible to the student" />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetAction}>Cancel</Button>
                  <Button size="sm" variant="destructive" disabled={busy || !text.trim()} className="gap-1.5" onClick={() => run(() => rejectDispute({ disputeId, reason: text }), 'Case rejected')}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Reject</Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Student / Risk */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Student Profile</p>
            <Field label="Name" value={student.fullName} />
            <Field label="Student ID" value={student.studentId} />
            <Field label="Department" value={student.department} />
            <Field label="Email" value={student.email} />
            <Field label="Account Status" value={student.status} />
            {student.flagged && <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs"><Flag className="w-3.5 h-3.5" /> Flagged: {student.flagReason || 'No reason given'}</div>}
          </div>
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Risk Score</p>
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-2xl font-bold tabular ${risk.score >= 50 ? 'text-destructive' : risk.score >= 25 ? 'text-[hsl(var(--chart-4))]' : 'text-[hsl(var(--chart-3))]'}`}>{risk.score}</span>
              <span className="text-xs text-muted-foreground">/ 100 · {risk.totalCases} total cases, {risk.rejectedCases} rejected</span>
            </div>
            {risk.factors.length > 0 ? (
              <ul className="text-[11px] text-muted-foreground list-disc list-inside space-y-0.5">{risk.factors.map((f, i) => <li key={i}>{f}</li>)}</ul>
            ) : <p className="text-[11px] text-muted-foreground">No risk signals.</p>}
          </div>
        </div>

        {/* Payment details (staff view — includes raw gateway callback log) */}
        {transaction && (
          <div className="rounded-xl border border-border/60 bg-card p-4 mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" /> Payment Details</p>
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/40">
              <span className="text-lg font-bold text-foreground tabular">{formatCurrency(transaction.transaction.amount)}</span>
              <StatusBadge status={transaction.transaction.status} />
            </div>
            <Field icon={Hash} label="Transaction ID" value={<span className="font-mono text-xs">{transaction.transaction.id}</span>} />
            <Field icon={Hash} label="Reference" value={<span className="font-mono text-xs">{transaction.transaction.reference}</span>} />
            {transaction.gateway?.validationId && <Field icon={Shield} label="SSLCommerz Validation ID" value={<span className="font-mono text-xs">{transaction.gateway.validationId}</span>} />}
            <Field icon={User} label="Sender" value={transaction.sender?.name} />
            <Field icon={User} label="Receiver" value={transaction.receiver?.name} />
            <Field label="Gateway" value={transaction.gateway?.provider} />
            <Field icon={Clock} label="Time" value={new Date(transaction.transaction.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })} />
            <Field icon={MapPin} label="IP" value={transaction.transaction.ipAddress || 'Not recorded'} />
            <Field icon={Smartphone} label="Device" value={transaction.transaction.deviceInfo || 'Not recorded'} />
            {transaction.gateway && transaction.gateway.callbacks.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Gateway Callback Log</p>
                <div className="space-y-1">
                  {transaction.gateway.callbacks.map(c => (
                    <div key={c.id} className="text-[10px] font-mono text-muted-foreground flex justify-between">
                      <span>{c.source} — {c.sslStatus || 'N/A'} — {c.verified ? 'verified' : 'unverified'}</span>
                      <span>{new Date(c.createdAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Related transactions & previous cases */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Previous Cases ({previousCases.length})</p>
            {previousCases.length === 0 ? <p className="text-[11px] text-muted-foreground">None</p> : previousCases.map(c => (
              <button key={c.id} onClick={() => navigate(`/accounts/disputes/detail?disputeId=${c.id}`)} className="flex items-center justify-between w-full text-left py-1 text-xs hover:text-primary">
                <span className="font-mono">{c.caseNumber}</span><StatusBadge status={c.status} />
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Related Transactions ({relatedTransactions.length})</p>
            {relatedTransactions.slice(0, 6).map(t => (
              <div key={t.id} className="flex items-center justify-between py-1 text-xs">
                <span className="font-mono text-muted-foreground">{t.reference}</span>
                <span className="font-medium">{formatCurrency(t.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Refunds */}
        {refunds.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-card p-4 mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><Banknote className="w-3.5 h-3.5" /> Refunds</p>
            {refunds.map(r => (
              <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0 text-xs">
                <div>
                  <span className="font-medium">{r.amountType} · {r.method}</span>
                  <span className="text-muted-foreground ml-2">{formatCurrency(r.amount)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.status === 'Pending' && <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" disabled={busy} onClick={() => run(() => rejectRefund({ refundId: r.id, reason: 'Rejected by Accounts Office' }), 'Refund rejected')}>Reject</Button>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div className="rounded-xl border border-border/60 bg-accent/20 p-4 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Audit Timeline</p>
          <div className="space-y-2">
            {timeline.map(t => (
              <div key={t.id} className="flex items-start gap-2.5 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <div><span className="text-foreground">{t.summary}</span> <span className="text-muted-foreground ml-1">{new Date(t.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'short', timeStyle: 'short' })}</span></div>
              </div>
            ))}
          </div>
        </div>

        {/* Conversation (internal notes visible here for staff) */}
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Conversation</p>
        <div className="space-y-2.5 mb-6">
          {messages.length === 0 && <p className="text-xs text-muted-foreground italic py-3 text-center">No messages yet.</p>}
          {messages.map((m, i) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
              className={`rounded-xl border p-3.5 ${m.isInternal ? 'border-[hsl(var(--chart-4))]/30 bg-[hsl(var(--chart-4))]/5' : 'border-border/60 bg-card'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-foreground">{m.authorName} {m.authorRole && <span className="text-primary">({m.authorRole})</span>} {m.isInternal && <span className="text-[hsl(var(--chart-4))] ml-1">· Internal</span>}</span>
                <span className="text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line">{m.body}</p>
            </motion.div>
          ))}
        </div>

        {/* Audit log */}
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Security Audit Log</p>
          <div className="space-y-1">
            {auditLogs.map(a => (
              <div key={a.id} className="text-[10px] font-mono text-muted-foreground flex justify-between gap-2">
                <span className="truncate">{a.action} — {a.details}</span>
                <span className="shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </FadeIn>
    </div>
  );
}
