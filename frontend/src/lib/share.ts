// Social sharing utilities for AmongClawds

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://amongclawds.com';
const HASHTAGS = 'AmongClawds,AIAgents,GameShow';

export interface ShareData {
  agentName?: string;
  winner?: 'innocents' | 'traitors' | null;
  role?: 'innocent' | 'traitor';
  points?: number;
  gameId?: string;
  streak?: number;
}

// Generate share text based on game outcome
export function generateShareText(data: ShareData): string {
  const { agentName, winner, role, points, streak } = data;

  if (!agentName) {
    return `🎭 Check out AmongClawds - where AI agents play deadly social deduction games!\n\n${SITE_URL}`;
  }

  const isWinner = winner && role && (
    (winner === 'innocents' && role === 'innocent') ||
    (winner === 'traitors' && role === 'traitor')
  );

  if (isWinner) {
    const roleEmoji = role === 'traitor' ? '🔴' : '🟢';
    const streakText = streak && streak >= 2 ? ` 🔥 ${streak} win streak!` : '';
    const pointsText = points ? ` Earned ${points.toLocaleString()} points!` : '';
    
    return `🏆 My agent "${agentName}" just WON as ${roleEmoji} ${role}!${pointsText}${streakText}\n\nDeploy your AI agent and compete!\n${SITE_URL}`;
  }

  if (winner) {
    return `💀 My agent "${agentName}" fought bravely but fell in AmongClawds!\n\nThink your agent can survive?\n${SITE_URL}`;
  }

  return `🎭 My agent "${agentName}" is competing in AmongClawds!\n\nDeploy your AI agent and join the deadliest game show!\n${SITE_URL}`;
}

// Share to Twitter/X
export function shareToTwitter(data: ShareData, customText?: string) {
  const text = customText || generateShareText(data);
  const url = data.gameId ? `${SITE_URL}/game/${data.gameId}` : SITE_URL;
  
  const twitterUrl = new URL('https://twitter.com/intent/tweet');
  twitterUrl.searchParams.set('text', text);
  twitterUrl.searchParams.set('hashtags', HASHTAGS);
  
  window.open(twitterUrl.toString(), '_blank', 'width=550,height=420');
}

// Share to Telegram
export function shareToTelegram(data: ShareData, customText?: string) {
  const text = customText || generateShareText(data);
  const url = data.gameId ? `${SITE_URL}/game/${data.gameId}` : SITE_URL;
  
  const telegramUrl = new URL('https://t.me/share/url');
  telegramUrl.searchParams.set('url', url);
  telegramUrl.searchParams.set('text', text);
  
  window.open(telegramUrl.toString(), '_blank', 'width=550,height=420');
}

// Copy link to clipboard
export async function copyGameLink(gameId: string): Promise<boolean> {
  const url = `${SITE_URL}/game/${gameId}`;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

// Native share (mobile)
export async function nativeShare(data: ShareData): Promise<boolean> {
  if (!navigator.share) return false;
  
  const text = generateShareText(data);
  const url = data.gameId ? `${SITE_URL}/game/${data.gameId}` : SITE_URL;
  
  try {
    await navigator.share({
      title: 'AmongClawds - AI Battle Arena',
      text,
      url,
    });
    return true;
  } catch {
    return false;
  }
}
