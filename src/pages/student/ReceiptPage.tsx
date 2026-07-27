import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, Loader2, FileText, Share2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getReceipt } from '@/lib/api';
import { FadeIn } from '@/components/PageTransition';

export default function ReceiptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const txId = searchParams.get('txId') || '';
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');

  const handleGenerate = async () => {
    if (!txId) { toast.error('No transaction ID'); return; }
    setLoading(true);
    try {
      const res = await getReceipt({ transactionId: txId });
      setPdfUrl(res.url);
    } catch (e: any) { toast.error(e.message || 'Failed to generate receipt'); }
    finally { setLoading(false); }
  };

  // Auto-generate on mount if txId is present
  useEffect(() => {
    if (txId && !pdfUrl) handleGenerate();
  }, [txId]);

  const handleShare = async () => {
    if (navigator.share && pdfUrl) {
      try { await navigator.share({ title: 'Payment Receipt', url: pdfUrl }); }
      catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(pdfUrl);
      toast.success('Receipt link copied to clipboard');
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <h1 className="text-lg font-bold text-foreground">Payment Receipt</h1>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground font-medium">Generating receipt...</p>
        </div>
      ) : !pdfUrl ? (
        <FadeIn>
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
              <FileText className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-base font-bold text-foreground mb-2">Generate Receipt</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Create a downloadable PDF receipt with all transaction details.
            </p>
            <Button onClick={handleGenerate} disabled={!txId} className="font-semibold">
              <Download className="w-4 h-4 mr-2" /> Generate PDF Receipt
            </Button>
          </div>
        </FadeIn>
      ) : (
        <FadeIn>
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
              <iframe src={pdfUrl} className="w-full h-[500px] sm:h-[600px]" title="Receipt PDF" />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild className="flex-1 font-semibold">
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" /> Open PDF
                </a>
              </Button>
              <Button variant="outline" onClick={handleShare} className="flex-1">
                <Share2 className="w-4 h-4 mr-2" /> Share Receipt
              </Button>
              <Button variant="outline" onClick={() => navigate('/student/ledger')}>
                Back to Ledger
              </Button>
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  );
}
