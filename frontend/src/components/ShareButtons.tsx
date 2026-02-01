'use client';

import { useState } from 'react';
import { Share2, Check, Link, Twitter } from 'lucide-react';
import { ShareData, shareToTwitter, shareToTelegram, copyGameLink, nativeShare } from '@/lib/share';

interface ShareButtonsProps {
  data: ShareData;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function ShareButtons({ data, showLabel = true, size = 'md' }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (data.gameId && await copyGameLink(data.gameId)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleNativeShare = async () => {
    const success = await nativeShare(data);
    if (!success) {
      // Fallback to Twitter
      shareToTwitter(data);
    }
  };

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 20 : 16;
  const padding = size === 'sm' ? 'px-2 py-1' : size === 'lg' ? 'px-4 py-2' : 'px-3 py-1.5';
  const textSize = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Twitter/X */}
      <button
        onClick={() => shareToTwitter(data)}
        className={`flex items-center gap-2 ${padding} rounded-lg bg-black hover:bg-gray-900 border border-gray-700 hover:border-gray-600 transition-all ${textSize}`}
        title="Share on X (Twitter)"
      >
        <svg className={`w-${iconSize/4} h-${iconSize/4}`} style={{ width: iconSize, height: iconSize }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
        {showLabel && <span>Share</span>}
      </button>

      {/* Telegram */}
      <button
        onClick={() => shareToTelegram(data)}
        className={`flex items-center gap-2 ${padding} rounded-lg bg-[#0088cc]/20 hover:bg-[#0088cc]/30 border border-[#0088cc]/50 text-[#0088cc] transition-all ${textSize}`}
        title="Share on Telegram"
      >
        <svg style={{ width: iconSize, height: iconSize }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
        {showLabel && <span>Telegram</span>}
      </button>

      {/* Copy Link */}
      {data.gameId && (
        <button
          onClick={handleCopy}
          className={`flex items-center gap-2 ${padding} rounded-lg bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700 transition-all ${textSize}`}
          title="Copy link"
        >
          {copied ? (
            <>
              <Check size={iconSize} className="text-green-400" />
              {showLabel && <span className="text-green-400">Copied!</span>}
            </>
          ) : (
            <>
              <Link size={iconSize} />
              {showLabel && <span>Copy</span>}
            </>
          )}
        </button>
      )}

      {/* Native Share (mobile) */}
      {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
        <button
          onClick={handleNativeShare}
          className={`flex items-center gap-2 ${padding} rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/50 text-purple-400 transition-all ${textSize}`}
          title="Share"
        >
          <Share2 size={iconSize} />
          {showLabel && <span>More</span>}
        </button>
      )}
    </div>
  );
}
