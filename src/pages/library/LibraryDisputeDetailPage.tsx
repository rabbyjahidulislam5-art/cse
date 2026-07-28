import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Send, CheckCircle2, XCircle, HeartHandshake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import StatusBadge from '@/components/StatusBadge';
import { FadeIn } from '@/components/PageTransition';
import { formatCurrency } from '@/lib/mock-data';
import { getLibraryDisputeDetail, replyToLibraryDispute, recommendLibraryDecision, type AccountsDisputeDetail } from '@/lib/disputeApi';

export default function LibraryDisputeDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const disputeId = searchParams.get('disputeId') || '';

  const [detail, setDetail] = useState<AccountsDisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');

  const load = () => { if (!disputeId) return; setLoading(true); getLibraryDisputeDetail({ disputeId }).then(setDetail).catch((e: any) => toast.error(e.message)).finally(() => setLoading(false)); };
  useEffect(load, [disputeId]);

  const handleReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try { await replyToLibraryDispute({ disputeId, body: reply.trim() }); setReply(''); toast.success('Reply sent'); load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const handleRecommend = async (decision: 'Approve' | 'Reject' | 'Waive') => {
    setBusy(true);
    try { await recommendLibraryDecision({ disputeId, decision }); toast.success(`Recommendation sent: ${decision}`); load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--chart-3))]" /></div>;
  if (!detail) return <p className="text-center text-sm text-muted-foreground py-24">Case not found.</p>;

  const { dispute, student, transaction, messages } = detail;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/library/disputes')} className="p-2 rounded-xl hover:bg-accent transition-colors"><ArrowLeft className="w-5 h-5 text-muted-foreground" /></button>
        <div className="flex-1"><h1 className="text-lg font-bold text-foreground font-mono">{dispute.caseNumber}</h1><p className="text-xs text-muted-foreground">{dispute.category}</p></div>
        <StatusBadge status={dispute.status} />
      </div>

      <FadeIn>
        <div className="rounded-xl border border-border/60 bg-card p-4 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Description</p>
          <p className="text-sm text-foreground leading-relaxed mb-3">{dispute.description}</p>
          <div className="flex justify-between text-xs text-muted-foreground pt-3 border-t border-border/40">
            <span>{student.fullName} ({student.studentId})</span>
            {transaction && <span>{formatCurrency(transaction.transaction.amount)} · {transaction.transaction.type}</span>}
          </div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--chart-3))]/30 bg-[hsl(var(--chart-3))]/5 p-4 mb-4">
          <p className="text-xs font-semibold text-[hsl(var(--chart-3))] uppercase tracking-wide mb-3">Library Recommendation</p>
          <p className="text-xs text-muted-foreground mb-3">Library doesn't process refunds directly — your recommendation is recorded and the case is forwarded back to Accounts to action.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} className="gap-1.5" onClick={() => handleRecommend('Approve')}><CheckCircle2 className="w-3.5 h-3.5" /> Approve</Button>
            <Button size="sm" variant="outline" className="gap-1.5 border-destructive/40 text-destructive" disabled={busy} onClick={() => handleRecommend('Reject')}><XCircle className="w-3.5 h-3.5" /> Reject</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => handleRecommend('Waive')}><HeartHandshake className="w-3.5 h-3.5" /> Waive</Button>
          </div>
        </div>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Conversation</p>
        <div className="space-y-2.5 mb-4">
          {messages.filter(m => !m.isInternal).length === 0 && <p className="text-xs text-muted-foreground italic py-3 text-center">No replies yet.</p>}
          {messages.filter(m => !m.isInternal).map(m => (
            <div key={m.id} className="rounded-xl border border-border/60 bg-card p-3.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-foreground">{m.authorName} {m.authorRole && <span className="text-[hsl(var(--chart-3))]">({m.authorRole})</span>}</span>
                <span className="text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line">{m.body}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-3.5">
          <Textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply to the student..." className="min-h-[80px] rounded-lg bg-accent/30 border-border/60 text-sm resize-none mb-2.5" />
          <Button size="sm" className="gap-1.5" disabled={busy || !reply.trim()} onClick={handleReply}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send</Button>
        </div>
      </FadeIn>
    </div>
  );
}
