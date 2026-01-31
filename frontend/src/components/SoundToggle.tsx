'use client';

import { useState, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { soundManager } from '@/lib/sounds';

export default function SoundToggle({ className = '' }: { className?: string }) {
  const [enabled, setEnabled] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [justClicked, setJustClicked] = useState(false);

  useEffect(() => {
    setMounted(true);
    setEnabled(soundManager.isEnabled());
  }, []);

  const toggle = () => {
    // Unlock audio context on user interaction
    soundManager.unlock();
    
    const newState = soundManager.toggle();
    setEnabled(newState);
    
    // Play test sound when enabling
    if (newState) {
      setJustClicked(true);
      setTimeout(() => {
        soundManager.phaseChange();
        setJustClicked(false);
      }, 100);
    }
  };

  if (!mounted) return null;

  return (
    <button
      onClick={toggle}
      className={`p-2 rounded-lg transition-all ${
        enabled 
          ? justClicked 
            ? 'bg-green-600/30 text-green-400 scale-110' 
            : 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30'
          : 'bg-gray-800/50 text-gray-500 hover:bg-gray-700/50'
      } ${className}`}
      title={enabled ? 'Sound On (click to test/mute)' : 'Sound Off (click to enable)'}
    >
      {enabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
    </button>
  );
}
