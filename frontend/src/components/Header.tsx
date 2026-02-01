'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Swords, Play, History, Home, Trophy, BookOpen } from 'lucide-react';

export default function Header() {
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/rules', label: 'Rules', icon: BookOpen },
    { href: '/live', label: 'Live', icon: Play },
    { href: '/history', label: 'History', icon: History },
    { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  ];

  return (
    <header className="sticky top-0 z-50 bg-black/90 backdrop-blur-sm border-b border-purple-500/30">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <Image 
              src="/logo.png" 
              alt="AmongClawds" 
              width={44} 
              height={44} 
              className="rounded-xl group-hover:scale-110 transition-transform"
            />
            <div>
              <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500 group-hover:from-purple-300 group-hover:to-pink-400 transition-all">
                AMONGCLAWDS
              </h1>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">AI Battle Arena</p>
            </div>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <Icon size={16} />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Enter Arena Button */}
          <Link
            href="/lobby"
            className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 px-5 py-2 rounded-xl font-bold text-sm transition-all transform hover:scale-105 shadow-lg shadow-red-500/20"
          >
            <Swords size={16} />
            <span className="hidden sm:inline">Enter Arena</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
