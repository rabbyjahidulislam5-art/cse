import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  ScrollText, ArrowRight, ArrowLeft, Loader2, CheckCircle2, Paperclip, X, FileText, Image as ImageIcon,
  UserX, DollarSign, Copy, Store, PackageX, XCircle, HelpCircle, ShieldAlert, MousePointerClick, ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';
import { createDispute, DISPUTE_CATEGORIES, MIN_DISPUTE_DESCRIPTION_LENGTH, type DisputeCategory } from '@/lib/disputeApi';
import { formatCurrency } from '@/lib/mock-data';

interface DisputeWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string;
  transactionSummary?: { reference: string; amount: number; type: string };
  onSubmitted?: (caseNumber: string) => void;
}

type Step = 'category' | 'details' | 'review' | 'success';

const CATEGORY_META: Record<DisputeCategory, { icon: typeof HelpCircle; description: string }> = {
  'Wrong Receiver': { icon: UserX, description: 'Money went to the wrong person or shop.' },
  'Wrong Amount': { icon: DollarSign, description: 'The amount charged does not match what you expected.' },
  'Duplicate Payment': { icon: Copy, description: 'You were charged more than once for the same thing.' },
  'Merchant Issue': { icon: Store, description: 'A problem with a shop or merchant transaction.' },
  'Service Not Received': { icon: PackageX, description: "You paid but didn't receive the item or service." },
  'Failed Service': { icon: XCircle, description: 'The service was provided but failed or was incomplete.' },
  'Payment Success But Not Reflected': { icon: ShieldAlert, description: 'Payment succeeded but a due/fine still shows pending.' },
  'Accidental Payment': { icon: MousePointerClick, description: 'You made this payment by mistake.' },
  'Fraud': { icon: ShieldAlert, description: 'You believe this transaction was unauthorized or fraudulent.' },
  'Other': { icon: HelpCircle, description: 'Something else not covered by the categories above.' },
};

const MAX_FILES = 5;
const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.webp,.pdf';

export default function DisputeWizard({ open, onOpenChange, transactionId, transactionSummary, onSubmitted }: DisputeWizardProps) {
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<DisputeCategory | null>(null);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [caseNumber, setCaseNumber] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStep('category'); setCategory(null); setDescription(''); setFiles([]); setSubmitting(false); setCaseNumber('');
    }
  }, [open]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (files.length + picked.length > MAX_FILES) {
      toast.error(`You can attach up to ${MAX_FILES} files.`);
      return;
    }
    const tooBig = picked.filter(f => f.size > 10 * 1024 * 1024);
    if (tooBig.length) toast.error(`${tooBig[0].name} exceeds the 10MB limit and was skipped.`);
    setFiles(prev => [...prev, ...picked.filter(f => f.size <= 10 * 1024 * 1024)]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!category || !transactionId) return;
    setSubmitting(true);
    try {
      const res = await createDispute({ transactionId, category, description: description.trim() }, files);
      setCaseNumber(res.caseNumber);
      if (res.skippedFiles.length) {
        toast.warning(`Case created, but ${res.skippedFiles.length} file(s) couldn't be attached: ${res.skippedFiles.map(f => f.name).join(', ')}`);
      }
      setStep('success');
      onSubmitted?.(res.caseNumber);
    } catch (e: any) {
      toast.error(e.message || 'Failed to raise dispute.');
    } finally {
      setSubmitting(false);
    }
  };

  const descriptionValid = description.trim().length >= MIN_DISPUTE_DESCRIPTION_LENGTH;

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg glass-strong rounded-2xl p-6">
        {step === 'category' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
                <div className="w-9 h-9 rounded-xl bg-destructive/15 border border-destructive/20 flex items-center justify-center text-destructive">
                  <ScrollText className="w-5 h-5" />
                </div>
                Raise a Dispute
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Step 1 of 3 — What went wrong with this payment?
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 my-2 max-h-[360px] overflow-y-auto pr-1">
              {DISPUTE_CATEGORIES.map((c) => {
                const meta = CATEGORY_META[c];
                const selected = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all ${
                      selected ? 'bg-destructive/10 border-destructive/40 shadow-sm' : 'bg-card border-border/60 hover:border-destructive/30'
                    }`}
                  >
                    <meta.icon className={`w-4 h-4 mt-0.5 shrink-0 ${selected ? 'text-destructive' : 'text-muted-foreground'}`} />
                    <div>
                      <div className={`text-xs font-semibold ${selected ? 'text-destructive' : 'text-foreground'}`}>{c}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{meta.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={() => setStep('details')} disabled={!category} className="rounded-xl font-semibold gap-2">
                Next <ArrowRight className="w-4 h-4" />
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'details' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
                <div className="w-9 h-9 rounded-xl bg-destructive/15 border border-destructive/20 flex items-center justify-center text-destructive">
                  <FileText className="w-5 h-5" />
                </div>
                Describe the Issue
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Step 2 of 3 — Give as much detail as possible so we can investigate quickly.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-2">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain what happened, when, and what you expect to happen next..."
                  className="min-h-[140px] rounded-xl bg-card border-border/60 focus:border-destructive text-sm resize-none"
                  maxLength={2000}
                />
                <p className={`text-[11px] mt-1.5 ${descriptionValid ? 'text-muted-foreground' : 'text-destructive'}`}>
                  {description.trim().length}/{MIN_DISPUTE_DESCRIPTION_LENGTH} characters minimum
                </p>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Attachments <span className="font-normal normal-case text-muted-foreground/70">(optional — images, screenshots, PDF)</span>
                </Label>
                <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_TYPES} onChange={handleFileSelect} className="hidden" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={files.length >= MAX_FILES}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-border/60 hover:border-destructive/40 text-xs font-medium text-muted-foreground transition-colors disabled:opacity-50"
                >
                  <Paperclip className="w-4 h-4" /> Add files ({files.length}/{MAX_FILES})
                </button>
                {files.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/40 text-xs">
                        <span className="flex items-center gap-1.5 truncate">
                          {f.type === 'application/pdf' ? <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                          <span className="truncate">{f.name}</span>
                          <span className="text-muted-foreground shrink-0">({(f.size / 1024).toFixed(0)}KB)</span>
                        </span>
                        <button type="button" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="shrink-0 text-muted-foreground hover:text-destructive">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setStep('category')} className="rounded-xl gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
              <Button onClick={() => setStep('review')} disabled={!descriptionValid} className="rounded-xl font-semibold gap-2">
                Next <ArrowRight className="w-4 h-4" />
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'review' && category && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
                <div className="w-9 h-9 rounded-xl bg-destructive/15 border border-destructive/20 flex items-center justify-center text-destructive">
                  <ListChecks className="w-5 h-5" />
                </div>
                Review & Submit
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">Step 3 of 3 — Confirm before we open your case.</DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-2.5 my-2">
              {transactionSummary && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Transaction</span>
                    <span className="font-mono text-xs text-foreground">{transactionSummary.reference}</span>
                  </div>
                  <div className="flex justify-between text-sm pb-2 border-b border-border/40">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-bold text-foreground tabular">{formatCurrency(transactionSummary.amount)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Category</span>
                <span className="font-semibold text-foreground text-right">{category}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground block mb-1">Description</span>
                <p className="text-foreground text-xs leading-relaxed bg-card rounded-lg p-2.5 border border-border/40">{description.trim()}</p>
              </div>
              {files.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Attachments</span>
                  <span className="font-medium text-foreground">{files.length} file(s)</span>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setStep('details')} disabled={submitting} className="rounded-xl gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
              <Button onClick={handleSubmit} disabled={submitting} className="rounded-xl font-semibold gap-2">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScrollText className="w-4 h-4" />}
                {submitting ? 'Submitting...' : 'Submit Dispute'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'success' && (
          <>
            <DialogHeader className="text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-[hsl(var(--chart-3))]/10 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-8 h-8 text-[hsl(var(--chart-3))]" />
              </div>
              <DialogTitle className="text-lg font-bold text-center">Case Opened</DialogTitle>
              <DialogDescription className="text-sm text-center">
                Case Number: <strong className="text-foreground font-mono">{caseNumber}</strong>
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-border/60 bg-accent/30 p-4 space-y-2.5 my-2 text-sm text-center">
              <p className="text-muted-foreground">
                The Accounts Office has been notified and will review your case. You'll get updates here and via email.
              </p>
            </div>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} className="w-full rounded-xl font-semibold">Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
