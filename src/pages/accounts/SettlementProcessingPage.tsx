import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Landmark, ArrowUpRight, Search, CheckCircle2, ShieldCheck, Mail, KeyRound,
  Loader2, Building2, Clock, FileText, ChevronRight, RefreshCw, Check, X, AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import {
  getAccountsSettlements,
  getAccountsSettlementDetail,
  processAccountsSettlementOtp,
  verifyAccountsSettlementOtp,
  executeAccountsSettlementPayment,
  type SettlementRequestItem,
  type SettlementTimelineItem,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { FadeIn } from '@/components/PageTransition';

export default function SettlementProcessingPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<SettlementRequestItem[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('Approved');
  const [search, setSearch] = useState('');

  // Selected Request / Detail Modal State
  const [selectedRequest, setSelectedRequest] = useState<SettlementRequestItem | null>(null);
  const [timeline, setTimeline] = useState<SettlementTimelineItem[]>([]);
  const [previousSettlements, setPreviousSettlements] = useState<any[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // OTP Verification Modal State
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [otpId, setOtpId] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [executingPayment, setExecutingPayment] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const load = () => {
    setLoading(true);
    getAccountsSettlements({ status: statusFilter, search })
      .then(d => {
        setRequests(d.requests || []);
        setStatusCounts(d.statusCounts || {});
      })
      .catch(() => toast.error('Failed to load settlement queue'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const openDetail = async (reqItem: SettlementRequestItem) => {
    setSelectedRequest(reqItem);
    setDetailModalOpen(true);
    setLoadingDetail(true);
    try {
      const d = await getAccountsSettlementDetail({ requestId: reqItem.id });
      setTimeline(d.timeline || []);
      setPreviousSettlements(d.previousSettlements || []);
    } catch (e: any) {
      toast.error('Failed to load settlement details');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleStartPayout = async () => {
    if (!selectedRequest) return;
    setSendingOtp(true);
    try {
      const res = await processAccountsSettlementOtp();
      setOtpId(res.otpId);
      setOtpVerified(false);
      setCode(['', '', '', '', '', '']);
      setOtpModalOpen(true);
      toast.success(`OTP sent to ${user?.email}`);
      setTimeout(() => inputRefs.current[0]?.focus(), 300);
    } catch (e: any) {
      toast.error(e.message || 'Failed to send OTP');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleDigitChange = (index: number, val: string) => {
    if (!/^\d*$/.test(val)) return;
    const digit = val.slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtpAndExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;
    const fullCode = code.join('');
    if (fullCode.length !== 6) {
      toast.error('Enter full 6-digit OTP code');
      return;
    }
    setVerifyingOtp(true);
    try {
      // Step 1: Verify OTP
      await verifyAccountsSettlementOtp({ otpId, code: fullCode });
      setOtpVerified(true);
      setVerifyingOtp(false);

      // Step 2: Execute Payout & Wallet Credit
      setExecutingPayment(true);
      const res = await executeAccountsSettlementPayment({
        requestId: selectedRequest.id,
        otpVerified: true,
        referenceNotes: 'Processed by Accounts Officer via OTP verification',
      });

      toast.success(`Settlement ${res.request.reference} paid successfully! Wallet credited.`);
      setOtpModalOpen(false);
      setDetailModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Payment execution failed');
      setVerifyingOtp(false);
      setExecutingPayment(false);
    }
  };

  if (loading && !requests.length) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl space-y-6">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl space-y-6">
      {/* Top Banner */}
      <FadeIn>
        <div className="relative rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/5 p-6 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Landmark className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold text-foreground">Accounts Office — Shop Pending Settlement</h1>
              </div>
            </div>

            <Button onClick={load} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh Queue
            </Button>
          </div>
        </div>
      </FadeIn>

      {/* Filter Tabs & Search */}
      <FadeIn delay={0.05}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {[
              { id: 'Approved', label: 'Approved by Admin', count: statusCounts.Approved },
              { id: 'Paid', label: 'Completed Payouts', count: statusCounts.Paid },
              { id: 'Failed', label: 'Failed', count: statusCounts.Failed },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                  statusFilter === tab.id
                    ? 'gradient-primary text-primary-foreground border-transparent shadow-md'
                    : 'bg-card text-muted-foreground border-border/60 hover:text-foreground'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-current font-mono">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reference, shop..."
              className="pl-9 text-xs bg-accent/50 border-border/60"
            />
          </div>
        </div>
      </FadeIn>

      {/* Settlement Queue List */}
      <FadeIn delay={0.1}>
        {requests.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500/40 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground mb-1">Queue is empty</h3>
            <p className="text-xs text-muted-foreground">No settlement requests found for the selected status filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(r => (
              <div
                key={r.id}
                onClick={() => openDetail(r)}
                className="rounded-xl border border-border/60 bg-card p-4 hover:border-primary/30 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                    <Building2 className="w-5 h-5" />
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-foreground truncate">{r.shop?.name || 'Shop'}</p>
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-muted-foreground font-mono">({r.reference})</span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Requested by {r.requestedBy?.fullName} · Bank: <strong className="text-foreground">{r.bankName || 'N/A'}</strong> ({r.bankAccountNumber || 'N/A'})
                    </p>

                    {r.adminRemarks && (
                      <p className="text-xs text-emerald-500/90 italic">Admin Approval Note: {r.adminRemarks}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                  <div className="text-left sm:text-right">
                    <p className="text-base font-extrabold text-foreground tabular">৳{r.requestedAmount.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        )}
      </FadeIn>

      {/* Detail & Process Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-2xl bg-card border-border/60 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-base">
              Settlement Payout: {selectedRequest?.reference}
              {selectedRequest && <StatusBadge status={selectedRequest.status} />}
            </DialogTitle>
            <DialogDescription>
              Accounts Office Payout Verification & Execution
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-5 py-2 text-xs">
              {/* Summary Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-accent/30 border border-border/40 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Payout Amount</p>
                  <p className="text-2xl font-extrabold text-primary tabular">৳{selectedRequest.requestedAmount.toLocaleString()}</p>
                  <p className="text-muted-foreground">Shop: <strong className="text-foreground">{selectedRequest.shop?.name}</strong></p>
                </div>

                <div className="p-4 rounded-xl bg-accent/30 border border-border/40 space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Disbursement Bank Account</p>
                  <p className="font-bold text-foreground">{selectedRequest.bankName || 'Not specified'}</p>
                  <p className="font-mono text-foreground">Acc: {selectedRequest.bankAccountNumber || 'N/A'}</p>
                  <p className="text-muted-foreground">Holder: {selectedRequest.bankAccountName || 'N/A'}</p>
                </div>
              </div>

              {/* Admin Approval Info */}
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                <p className="font-semibold text-emerald-500 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" /> Approved by Admin Office ({selectedRequest.adminReviewer || 'Admin'})
                </p>
                {selectedRequest.adminRemarks && (
                  <p className="text-foreground italic">"{selectedRequest.adminRemarks}"</p>
                )}
              </div>

              {/* Action Area */}
              {selectedRequest.status === 'Approved' || selectedRequest.status === 'Failed' ? (
                <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Authorize Settlement Payout</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Requires OTP verification sent to your Accounts Officer email ({user?.email})
                      </p>
                    </div>
                  </div>

                  <Button onClick={handleStartPayout} disabled={sendingOtp} className="w-full shadow-lg shadow-primary/20">
                    {sendingOtp ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1.5" />}
                    Proceed to OTP Verification & Payout
                  </Button>
                </div>
              ) : selectedRequest.status === 'Paid' ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-medium flex items-center justify-between">
                  <span>✓ Payment fully executed and shop wallet credited.</span>
                  <span className="font-mono text-xs">{selectedRequest.paidAt ? new Date(selectedRequest.paidAt).toLocaleDateString() : ''}</span>
                </div>
              ) : null}

              {/* Status Timeline */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Audit Timeline & History</h4>
                {loadingDetail ? (
                  <Skeleton className="h-20 rounded-xl" />
                ) : (
                  <div className="space-y-2">
                    {timeline.map(t => (
                      <div key={t.id} className="p-2.5 rounded-xl bg-accent/30 border border-border/40 flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-foreground">{t.fromStatus} → {t.toStatus}</span>
                          <p className="text-muted-foreground text-[11px]">By: {t.changedBy?.fullName || 'System'} ({t.changedBy?.role || ''})</p>
                          {t.reason && <p className="italic text-foreground mt-0.5">{t.reason}</p>}
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">{new Date(t.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* OTP Verification & Payout Execution Modal */}
      <Dialog open={otpModalOpen} onOpenChange={setOtpModalOpen}>
        <DialogContent className="max-w-md bg-card border-border/60">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Enter 6-Digit Accounts OTP
            </DialogTitle>
            <DialogDescription className="sr-only">
              Enter the OTP to verify the payout.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleVerifyOtpAndExecute} className="space-y-5 py-2">
            <div className="grid grid-cols-6 gap-2">
              {code.map((digit, idx) => (
                <input
                  key={idx}
                  ref={el => { inputRefs.current[idx] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleDigitChange(idx, e.target.value)}
                  onKeyDown={e => handleKeyDown(idx, e)}
                  className="w-full h-12 text-center text-lg font-bold bg-accent/50 border border-border/60 rounded-xl focus:border-primary focus:outline-none text-foreground"
                />
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOtpModalOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={verifyingOtp || executingPayment || code.join('').length !== 6}
                className="gradient-primary text-primary-foreground font-semibold shadow-lg"
              >
                {verifyingOtp || executingPayment ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
                Payout
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
