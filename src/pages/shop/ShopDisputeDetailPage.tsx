import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Send, Paperclip, X, FileText, Image as ImageIcon, StickyNote, Download, CheckCircle2, XCircle, HeartHandshake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import StatusBadge from '@/components/StatusBadge';
import { FadeIn } from '@/components/PageTransition';
import { formatCurrency } from '@/lib/mock-data';
import { getShopDisputeDetail, replyToShopDispute, recommendShopDecision, getDisputePdf, type AccountsDisputeDetail } from '@/lib/disputeApi';
import { triggerDownload } from '@/lib/download';
import { useDisputeRoom } from '@/lib/socket';

const MAX_FILES = 5;
const TERMINAL = ['Resolved', 'Rejected', 'Refunded', 'Closed'];

export default function ShopDisputeDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const disputeId = searchParams.get('disputeId') || '';

  const [detail, setDetail] = useState<AccountsDisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => { if (!disputeId) return; setLoading(true); getShopDisputeDetail({ disputeId }).then(setDetail).catch((e: any) => toast.error(e.message)).finally(() => setLoading(false)); };
  useEffect(load, [disputeId]);
  useDisputeRoom(disputeId, () => load());

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

  const handleReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await replyToShopDispute({ disputeId, body: reply.trim(), isInternal }, files);
      setReply(''); setFiles([]); setIsInternal(false);
      toast.success(isInternal ? 'Internal note added' : 'Reply sent');
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const handleRecommend = async (decision: 'Approve' | 'Reject' | 'Waive') => {
    setBusy(true);
    try { await recommendShopDecision({ disputeId, decision }); toast.success(`Recommendation sent: ${decision}`); load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-secondary" /></div>;
  if (!detail) return <p className="text-center text-sm text-muted-foreground py-24">Case not found.</p>;

  const { dispute, student, transaction, messages } = detail;
  const isTerminal = TERMINAL.includes(dispute.status);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/shop/disputes')} className="p-2 rounded-xl hover:bg-accent transition-colors"><ArrowLeft className="w-5 h-5 text-muted-foreground" /></button>
        <div className="flex-1"><h1 className="text-lg font-bold text-foreground font-mono">{dispute.caseNumber}</h1><p className="text-xs text-muted-foreground">{dispute.category}</p></div>
        <StatusBadge status={dispute.status} />
      </div>

      <FadeIn>
        <div className="flex flex-wrap gap-2 mb-4">
          <Button variant="outline" size="sm" className="rounded-lg gap-1.5 text-xs" disabled={pdfLoading} onClick={handlePdf}>
            {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download Case PDF
          </Button>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-4 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Customer's Description</p>
          <p className="text-sm text-foreground leading-relaxed mb-3">{dispute.description}</p>
          <div className="flex justify-between text-xs text-muted-foreground pt-3 border-t border-border/40">
            <span>{student.fullName} ({student.studentId})</span>
            {transaction && <span>{formatCurrency(transaction.transaction.amount)} · Ref: {transaction.transaction.reference}</span>}
          </div>
        </div>

        {!isTerminal && dispute.status === 'WaitingForShop' && (
          <div className="rounded-xl border border-[hsl(var(--chart-3))]/30 bg-[hsl(var(--chart-3))]/5 p-4 mb-4">
            <p className="text-xs font-semibold text-[hsl(var(--chart-3))] uppercase tracking-wide mb-3">Shop Verification</p>
            <p className="text-xs text-muted-foreground mb-3">Shop doesn't process refunds directly — your recommendation is recorded and the case is forwarded back to whoever sent it.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} className="gap-1.5" onClick={() => handleRecommend('Approve')}><CheckCircle2 className="w-3.5 h-3.5" /> Approve</Button>
              <Button size="sm" variant="outline" className="gap-1.5 border-destructive/40 text-destructive" disabled={busy} onClick={() => handleRecommend('Reject')}><XCircle className="w-3.5 h-3.5" /> Reject</Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => handleRecommend('Waive')}><HeartHandshake className="w-3.5 h-3.5" /> Waive</Button>
            </div>
          </div>
        )}

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Conversation</p>
        <div className="space-y-2.5 mb-4">
          {messages.length === 0 && <p className="text-xs text-muted-foreground italic py-3 text-center">No replies yet.</p>}
          {messages.map(m => (
            <div key={m.id} className={`rounded-xl border p-3.5 ${m.isInternal ? 'border-[hsl(var(--chart-4))]/30 bg-[hsl(var(--chart-4))]/5' : 'border-border/60 bg-card'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-foreground">{m.authorName} {m.authorRole && <span className="text-secondary">({m.authorRole})</span>} {m.isInternal && <span className="text-[hsl(var(--chart-4))] ml-1">· Internal</span>}</span>
                <span className="text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line">{m.body}</p>
              {m.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {m.attachments.map(a => (
                    <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/60 text-[10px] font-medium text-foreground hover:bg-accent">
                      {a.mimeType === 'application/pdf' ? <FileText className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />} {a.originalName}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {!isTerminal ? (
          <div className="rounded-xl border border-border/60 bg-card p-3.5">
            <Textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply, or explain with proof (invoice, photo, CCTV image, receipt)..." className="min-h-[90px] rounded-lg bg-accent/30 border-border/60 text-sm resize-none mb-2.5" />
            <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                if (files.length + picked.length > MAX_FILES) { toast.error(`Up to ${MAX_FILES} files.`); return; }
                setFiles(prev => [...prev, ...picked]);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }} />
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {files.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/60 text-[10px]">{f.name}
                    <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" className="rounded-lg gap-1.5 text-xs" onClick={() => fileInputRef.current?.click()} disabled={files.length >= MAX_FILES}>
                  <Paperclip className="w-3.5 h-3.5" /> Upload Proof
                </Button>
                <Button variant={isInternal ? 'default' : 'outline'} size="sm" className="rounded-lg gap-1.5 text-xs" onClick={() => setIsInternal(v => !v)}>
                  <StickyNote className="w-3.5 h-3.5" /> Internal Note
                </Button>
              </div>
              <Button size="sm" className="rounded-lg gap-1.5 text-xs" disabled={busy || !reply.trim()} onClick={handleReply}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-muted/50 border border-border/40 text-xs text-muted-foreground text-center">This case is {dispute.status.toLowerCase()} and no longer accepts replies.</div>
        )}
      </FadeIn>
    </div>
  );
}
