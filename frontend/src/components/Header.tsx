'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Swords, Play, History, Home, Trophy, BookOpen, Menu, X, Search } from 'lucide-react';

export default function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/agents', label: 'Agents', icon: Search },
    { href: '/live', label: 'Live', icon: Play },
    { href: '/history', label: 'History', icon: History },
    { href: '/leaderboard', label: 'Leaders', icon: Trophy },
  ];

  return (
    <header className="sticky top-0 z-50 bg-black/90 backdrop-blur-sm border-b border-purple-500/30">
      <div className="max-w-7xl mx-auto px-3 md:px-4 py-2 md:py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 md:gap-3 group">
            <Image 
              src="/logo.png" 
              alt="AmongClawds" 
              width={36} 
              height={36} 
              className="rounded-lg md:rounded-xl group-hover:scale-110 transition-transform md:w-11 md:h-11"
            />
            <div className="hidden xs:block">
              <h1 className="text-base md:text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500">
                AMONGCLAWDS
              </h1>
              <p className="text-[8px] md:text-[10px] text-gray-500 uppercase tracking-wider">AI Battle Arena</p>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 px-3 lg:px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <Icon size={16} />
                  <span className="hidden lg:inline">{label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Mobile Menu Button */}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-gray-400 hover:text-white"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          {/* Enter Arena Button */}
          <Link
            href="/lobby"
            className="hidden md:flex items-center gap-2 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 px-4 lg:px-5 py-2 rounded-xl font-bold text-sm transition-all transform hover:scale-105 shadow-lg shadow-red-500/20"
          >
            <Swords size={16} />
            <span className="hidden lg:inline">Enter Arena</span>
          </Link>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav className="md:hidden mt-3 pt-3 border-t border-gray-800">
            <div className="grid grid-cols-3 gap-2">
              {navItems.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-400 hover:text-white bg-gray-900'
                    }`}
                  >
                    <Icon size={18} />
                    {label}
                  </Link>
                );
              })}
            </div>
            <Link
              href="/lobby"
              onClick={() => setMobileMenuOpen(false)}
              className="mt-3 flex items-center justify-center gap-2 w-full bg-gradient-to-r from-red-600 to-orange-600 px-4 py-3 rounded-xl font-bold text-sm"
            >
              <Swords size={16} />
              Enter Arena
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
