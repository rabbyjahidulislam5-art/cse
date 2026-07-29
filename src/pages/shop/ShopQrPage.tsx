import { useState, useEffect } from 'react';
import { QrCode, RefreshCw, Maximize2, Minimize2, Loader2, Store, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { getShopDashboard, regenerateShopQr } from '@/lib/api';
import { motion } from 'framer-motion';

export default function ShopQrPage() {
  const [shopId, setShopId] = useState('');
  const [qrToken, setQrToken] = useState('');
  const [shopName, setShopName] = useState('');
  const [loading, setLoading] = useState(true);
  const [kiosk, setKiosk] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getShopDashboard({})
      .then(d => { setShopId(d.shop.id); setQrToken(d.shop.qrToken); setShopName(d.shop.name); })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Build the QR payload that students will scan
  const qrPayload = qrToken ? `SMARTCAMPUS:SHOP:${shopId}:${qrToken}` : '';

  // QR code image URL via free API
  const qrImageUrl = qrPayload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&format=png&data=${encodeURIComponent(qrPayload)}&color=1a1a2e&bgcolor=ffffff&margin=20`
    : '';

  const handleRegenerate = async () => {
    if (!shopId) return;
    setRegenerating(true);
    try {
      const res = await regenerateShopQr({ shopId });
      setQrToken(res.qrToken);
      toast.success('QR code regenerated successfully');
    } catch (e: any) { toast.error(e.message); }
    finally { setRegenerating(false); setConfirmRefresh(false); }
  };

  const toggleKiosk = () => {
    if (!kiosk) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
    setKiosk(!kiosk);
  };

  const copyQr = () => {
    navigator.clipboard.writeText(qrPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('QR data copied');
  };

  if (loading) return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-lg">
      <Skeleton className="h-8 w-48 mb-6" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );

  return (
    <div className={`${kiosk ? 'fixed inset-0 bg-background flex items-center justify-center z-50' : 'container mx-auto px-4 sm:px-6 py-6 max-w-lg'}`}>
      <div className="text-center w-full">
        {!kiosk && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <h1 className="text-xl font-bold text-foreground">Payment QR Code</h1>
            <p className="text-xs text-muted-foreground mt-1">Students scan this to pay</p>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className={`rounded-2xl border border-border/60 bg-card ${kiosk ? 'p-12' : 'p-6'}`}>
          
          <div className={`mx-auto bg-white rounded-2xl shadow-lg flex items-center justify-center overflow-hidden ${kiosk ? 'w-80 h-80' : 'w-64 h-64'}`}>
            {qrImageUrl ? (
              <img src={qrImageUrl} alt="Shop QR Code" className={`${kiosk ? 'w-72 h-72' : 'w-56 h-56'}`} />
            ) : (
              <div className="text-center p-8">
                <QrCode className="w-16 h-16 text-gray-300 mx-auto" />
                <p className="text-xs text-gray-400 mt-2">No QR token</p>
              </div>
            )}
          </div>

          <div className={`mt-4 ${kiosk ? 'mt-8' : ''}`}>
            <div className="flex items-center justify-center gap-2">
              <Store className={`text-primary ${kiosk ? 'w-6 h-6' : 'w-4 h-4'}`} />
              <p className={`font-bold text-foreground ${kiosk ? 'text-3xl' : 'text-lg'}`}>{shopName}</p>
            </div>
            <p className={`text-muted-foreground ${kiosk ? 'text-lg mt-2' : 'text-sm mt-1'}`}>Scan to pay</p>
          </div>
        </motion.div>

        {!kiosk && (
          <div className="space-y-3 mt-6">
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmRefresh(true)} disabled={regenerating}>
                {regenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Regenerate
              </Button>
              <Button variant="outline" className="flex-1" onClick={copyQr}>
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? 'Copied!' : 'Copy QR Data'}
              </Button>
            </div>
            <Button variant="outline" className="w-full hidden md:flex" onClick={toggleKiosk}>
              <Maximize2 className="w-4 h-4 mr-2" /> Kiosk Mode
            </Button>
            <p className="text-[10px] text-muted-foreground">
              QR Token: <span className="font-mono">{qrToken?.slice(0, 20)}...</span>
            </p>
          </div>
        )}

        {kiosk && (
          <Button variant="ghost" className="mt-8" onClick={toggleKiosk}>
            <Minimize2 className="w-4 h-4 mr-2" /> Exit Kiosk
          </Button>
        )}
      </div>

      <AlertDialog open={confirmRefresh} onOpenChange={setConfirmRefresh}>
        <AlertDialogContent className="glass-strong rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate QR Code?</AlertDialogTitle>
            <AlertDialogDescription>
              This will invalidate the current QR code immediately. Any printed copies will stop working. Students will need to scan the new QR code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? 'Regenerating...' : 'Regenerate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
