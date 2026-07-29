import { useCallback, useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';

type BarcodeFormatString =
  | 'qr_code'
  | 'ean_13'
  | 'ean_8'
  | 'code_128'
  | 'code_39'
  | 'upc_a'
  | 'upc_e';

declare global {
  class BarcodeDetector {
    constructor(options?: { formats: string[] });
    static getSupportedFormats(): Promise<string[]>;
    detect(image: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
  }
  interface MediaTrackConstraintSet {
    focusMode?: 'none' | 'manual' | 'single-shot' | 'continuous';
  }
}

const isValidEAN = (value: string, length: 8 | 13): boolean => {
  if (value.length !== length) return false;
  const nums = Array.from(value, c => c.charCodeAt(0) - 48);
  if (nums.some(n => n < 0 || n > 9)) return false;
  const check = nums.pop() as number;
  const weights = length === 13 ? [1, 3] : [3, 1];
  const sum = nums.reduce((acc, d, i) => acc + d * weights[i % 2], 0);
  return (10 - (sum % 10)) % 10 === check;
};

const isValidBarcode = (value: string, format: string): boolean => {
  if (format === 'ean_13') return isValidEAN(value, 13);
  if (format === 'ean_8') return isValidEAN(value, 8);
  if (format === 'upc_a') return isValidEAN('0' + value, 13);
  return true;
};

type ScannerProps = {
  onScan: (value: string, format: string) => void;
  formats?: BarcodeFormatString[];
  confirmations?: number;
};

export default function BarcodeScanner({
  onScan,
  formats = ['qr_code'],
  confirmations = 2,
}: ScannerProps) {
  const webcamRef = useRef<Webcam>(null);
  const detectorRef = useRef<BarcodeDetector | undefined>(undefined);
  const [error, setError] = useState<string>();
  const onScanRef = useRef(onScan);
  const confirmationsRef = useRef(confirmations);

  useEffect(() => {
    onScanRef.current = onScan;
    confirmationsRef.current = confirmations;
  });

  const formatsKey = formats.join(',');
  useEffect(() => {
    if (typeof BarcodeDetector === 'undefined') {
      setError('Barcode scanning isn’t supported in this browser. Please use Chrome on Android, or find the shop from the Shops list to pay directly.');
      detectorRef.current = undefined;
      return;
    }
    BarcodeDetector.getSupportedFormats()
      .then(supported => {
        const toUse = formats.filter(f => supported.includes(f));
        if (!toUse.length) {
          setError(`None of the requested barcode formats (${formats.join(', ')}) are supported in this browser.`);
          detectorRef.current = undefined;
          return;
        }
        setError(undefined);
        detectorRef.current = new BarcodeDetector({ formats: [...toUse] });
      })
      .catch(() => setError('Barcode detection not supported in this browser'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatsKey]);

  const handleUserMedia = useCallback((stream: MediaStream) => {
    const track = stream.getVideoTracks()[0];
    track?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }, []);

  useEffect(() => {
    let stopped = false;
    let busy = false;
    let lastValue: string | undefined;
    let matchCount = 0;
    let rafId = 0;

    const tick = async () => {
      const video = webcamRef.current?.video;
      if (
        video &&
        detectorRef.current &&
        !busy &&
        video.readyState >= 2 &&
        video.videoWidth > 0
      ) {
        busy = true;
        try {
          const [hit] = await detectorRef.current.detect(video);
          if (stopped) return;
          if (hit && isValidBarcode(hit.rawValue, hit.format)) {
            if (hit.rawValue === lastValue) {
              matchCount += 1;
            } else {
              lastValue = hit.rawValue;
              matchCount = 1;
            }
            if (matchCount >= confirmationsRef.current) {
              stopped = true;
              navigator.vibrate?.(50);
              onScanRef.current(hit.rawValue, hit.format);
              return;
            }
          } else {
            lastValue = undefined;
            matchCount = 0;
          }
        } catch {
          // transient frame error
        } finally {
          busy = false;
        }
      }
      if (!stopped) rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  if (error) return <div className="text-center p-4 text-destructive text-sm">{error}</div>;

  return (
    <div className="relative rounded-xl overflow-hidden">
      <Webcam
        ref={webcamRef}
        audio={false}
        onUserMedia={handleUserMedia}
        onUserMediaError={() => setError('Camera access denied. Please allow camera permission and try again.')}
        videoConstraints={{
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }}
        className="w-full rounded-xl"
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-56 h-56 border-2 border-primary/60 rounded-2xl" />
      </div>
    </div>
  );
}
