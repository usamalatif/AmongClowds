'use client';

import { useRef, useState, useCallback } from 'react';
import { Download, Share2, Check, Clipboard } from 'lucide-react';

interface ShareCardImageProps {
  children: React.ReactNode;
  filename?: string;
  watermark?: string;
  tweetText?: string;
  shareUrl?: string;
}

export default function ShareCardImage({ 
  children, 
  filename = 'amongclawds-card', 
  watermark = 'amongclawds.com',
  tweetText = 'Check out this matchup on @AmongClawds! 🦞⚔️',
  shareUrl,
}: ShareCardImageProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [twitterStep, setTwitterStep] = useState<'idle' | 'copied' | 'opening'>('idle');

  const capture = useCallback(async (): Promise<Blob | null> => {
    if (!cardRef.current) return null;
    setCapturing(true);
    try {
      const html2canvas = (await import('html2canvas-pro')).default;
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#0a0a0f',
        scale: 2,
        useCORS: true,
        logging: false,
        removeContainer: true,
      });

      // Add watermark
      const ctx = canvas.getContext('2d');
      if (ctx && watermark) {
        ctx.font = '600 24px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.textAlign = 'right';
        ctx.fillText(watermark, canvas.width - 32, canvas.height - 20);
      }

      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      });
    } catch (err) {
      console.error('Capture failed:', err);
      return null;
    } finally {
      setCapturing(false);
    }
  }, [watermark]);

  const handleDownload = useCallback(async () => {
    const blob = await capture();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [capture, filename]);

  const handleCopyImage = useCallback(async (): Promise<boolean> => {
    const blob = await capture();
    if (!blob) return false;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    } catch {
      // Clipboard API not available or denied — download as fallback
      return false;
    }
  }, [capture]);

  const handleShareTwitter = useCallback(async () => {
    setTwitterStep('copied');
    
    // Copy image to clipboard
    const didCopy = await handleCopyImage();
    
    // Build tweet URL
    const url = shareUrl || (typeof window !== 'undefined' ? window.location.href : '');
    const fullText = `${tweetText}\n\n${url}`;
    const twitterUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(fullText)}`;
    
    if (didCopy) {
      // Show "copied" state briefly, then open Twitter
      setTwitterStep('opening');
      setTimeout(() => {
        window.open(twitterUrl, '_blank', 'noopener,noreferrer');
        // Reset after a bit
        setTimeout(() => setTwitterStep('idle'), 3000);
      }, 800);
    } else {
      // Couldn't copy — just open Twitter and download the image
      window.open(twitterUrl, '_blank', 'noopener,noreferrer');
      handleDownload();
      setTimeout(() => setTwitterStep('idle'), 2000);
    }
  }, [handleCopyImage, handleDownload, tweetText, shareUrl]);

  const handleShare = useCallback(async () => {
    const blob = await capture();
    if (!blob) return;

    const file = new File([blob], `${filename}.png`, { type: 'image/png' });

    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'AmongClawds',
          text: tweetText,
        });
        return;
      } catch {
        // User cancelled or share failed
      }
    }
    // Fallback to download
    handleDownload();
  }, [capture, filename, handleDownload, tweetText]);

  const isWorking = capturing || twitterStep !== 'idle';

  return (
    <div className="relative group">
      {/* The card content to capture */}
      <div ref={cardRef}>
        {children}
      </div>

      {/* Share buttons */}
      <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
        {/* Share on X / Twitter */}
        <button
          onClick={handleShareTwitter}
          disabled={isWorking}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black hover:bg-gray-900 border border-gray-700 hover:border-gray-500 text-white text-xs font-medium transition-all disabled:opacity-70"
        >
          {twitterStep === 'copied' ? (
            <>
              <Clipboard className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400">Image copied!</span>
            </>
          ) : twitterStep === 'opening' ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400">Paste in tweet ⌘V</span>
            </>
          ) : capturing ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              <span>Capturing...</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              <span>Share on X</span>
            </>
          )}
        </button>

        {/* Save Image */}
        <button
          onClick={handleDownload}
          disabled={isWorking}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white text-xs font-medium transition-all disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          Save Image
        </button>

        {/* Native Share (mobile) */}
        <button
          onClick={handleShare}
          disabled={isWorking}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 hover:border-purple-500/60 text-purple-400 hover:text-purple-300 text-xs font-medium transition-all disabled:opacity-50"
        >
          <Share2 className="w-3.5 h-3.5" />
          Share
        </button>
      </div>

      {/* Helper text when Twitter flow is active */}
      {twitterStep === 'opening' && (
        <p className="text-center text-[10px] text-gray-500 mt-1.5 animate-pulse">
          Image copied to clipboard — paste it into your tweet!
        </p>
      )}
    </div>
  );
}
