import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Loader2, Send, Paperclip, X, FileText, Image as ImageIcon, Download,
  Clock, History, MessageSquare, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import StatusBadge from '@/components/StatusBadge';
import TransactionDetailCard from '@/components/disputes/TransactionDetailCard';
import { FadeIn } from '@/components/PageTransition';
import {
  getDisputeDetail, replyToDispute, closeDispute, getDisputePdf, type DisputeDetail,
} from '@/lib/disputeApi';
import { triggerDownload } from '@/lib/download';

const TERMINAL_STATUSES = ['Resolved', 'Rejected', 'Refunded', 'Closed'];
const MAX_FILES = 5;

export default function DisputeDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const disputeId = searchParams.get('disputeId') || '';

  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    if (!disputeId) return;
    setLoading(true);
    getDisputeDetail({ disputeId }).then(setDetail).catch((e: any) => toast.error(e.message || 'Failed to load case.')).finally(() => setLoading(false));
  };

  useEffect(load, [disputeId]);

  const handleReply = async () => {
    if (!replyBody.trim()) return;
    setSending(true);
    try {
      await replyToDispute({ disputeId, body: replyBody.trim() }, replyFiles);
      setReplyBody(''); setReplyFiles([]);
      toast.success('Reply sent');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to send reply.');
    } finally {
      setSending(false);
    }
  };

  const handleClose = async () => {
    if (!confirm('Close this case? You can still view it afterward, but it will no longer accept replies.')) return;
    setClosing(true);
    try {
      await closeDispute({ disputeId, reason: 'Closed by student' });
      toast.success('Case closed');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to close case.');
    } finally {
      setClosing(false);
    }
  };

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!detail) {
    return <p className="text-center text-sm text-muted-foreground py-24">Case not found.</p>;
  }

  const { dispute, transaction, messages, timeline } = detail;
  const isTerminal = TERMINAL_STATUSES.includes(dispute.status);
  const canReply = !isTerminal;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/student/disputes')} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-foreground font-mono">{dispute.caseNumber}</h1>
          <p className="text-xs text-muted-foreground">{dispute.category}</p>
        </div>
        <StatusBadge status={dispute.status} />
      </div>

      <FadeIn>
        <div className="flex flex-wrap gap-2 mb-4">

          <Button variant="outline" size="sm" className="rounded-lg gap-1.5 text-xs" onClick={() => setShowTimeline(v => !v)}>
            <History className="w-3.5 h-3.5" /> {showTimeline ? 'Hide' : 'Show'} Audit Timeline
          </Button>
          {!isTerminal && (
            <Button variant="outline" size="sm" className="rounded-lg gap-1.5 text-xs text-destructive border-destructive/30 ml-auto" disabled={closing} onClick={handleClose}>
              {closing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Close Case
            </Button>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-4 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Description</p>
          <p className="text-sm text-foreground leading-relaxed">{dispute.description}</p>
          {dispute.slaDueAt && !isTerminal && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3 pt-3 border-t border-border/40">
              <Clock className="w-3.5 h-3.5" /> SLA target: {new Date(dispute.slaDueAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' })}
              {dispute.assignedToName && <span className="ml-auto">Assigned to {dispute.assignedToName}</span>}
            </div>
          )}
        </div>

        {showTimeline && (
          <div className="rounded-xl border border-border/60 bg-accent/20 p-4 mb-4 space-y-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Audit Timeline</p>
            {timeline.map(t => (
              <div key={t.id} className="flex items-start gap-2.5 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <div>
                  <span className="text-foreground">{t.summary}</span>
                  <span className="text-muted-foreground ml-2">{new Date(t.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {transaction && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Payment Details
            </p>
            <TransactionDetailCard transactionId={transaction.transaction.id} disableDispute />
          </div>
        )}

        {/* Messages */}
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" /> Conversation
        </p>
        <div className="space-y-3 mb-4">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-4 text-center">No replies yet.</p>
          )}
          {messages.map((m, i) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="rounded-xl border border-border/60 bg-card p-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-foreground">{m.authorName} {m.authorRole && m.authorRole !== 'Student' && <span className="text-primary">({m.authorRole})</span>}</span>
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
            </motion.div>
          ))}
        </div>

        {/* Reply box */}
        {canReply ? (
          <div className="rounded-xl border border-border/60 bg-card p-3.5">
            <Textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Type a reply..."
              className="min-h-[80px] rounded-lg bg-accent/30 border-border/60 text-sm resize-none mb-2.5"
            />
            <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                if (replyFiles.length + picked.length > MAX_FILES) { toast.error(`Up to ${MAX_FILES} files.`); return; }
                setReplyFiles(prev => [...prev, ...picked]);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            {replyFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {replyFiles.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/60 text-[10px]">
                    {f.name}
                    <button onClick={() => setReplyFiles(prev => prev.filter((_, idx) => idx !== i))}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" className="rounded-lg gap-1.5 text-xs" onClick={() => fileInputRef.current?.click()} disabled={replyFiles.length >= MAX_FILES}>
                <Paperclip className="w-3.5 h-3.5" /> Attach
              </Button>
              <Button size="sm" className="rounded-lg gap-1.5 text-xs" disabled={sending || !replyBody.trim()} onClick={handleReply}>
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 border border-border/40 text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 shrink-0" /> This case is {dispute.status.toLowerCase()} and no longer accepts replies.
          </div>
        )}
      </FadeIn>
    </div>
  );
}
