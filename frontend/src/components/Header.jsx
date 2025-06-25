import { LightningBoltIcon } from '@heroicons/react/24/solid';
import DarkModeToggle from './DarkModeToggle.jsx';

export default function Header() {
  return (
    <header className="flex justify-between items-center px-6 py-4 bg-primary dark:bg-indigo-900 shadow-card">
      <div className="flex items-center space-x-3 text-accent select-none">
        <LightningBoltIcon className="h-8 w-8 animate-pulse" />
        <h1 className="text-3xl font-extrabold tracking-tight">StockVision</h1>
      </div>

      <nav className="flex items-center space-x-4">
        <button className="text-accent border border-accent px-4 py-1 rounded hover:bg-accent hover:text-primary transition">
          ABOUT
        </button>
        <button className="text-accent border border-accent px-4 py-1 rounded hover:bg-accent hover:text-primary transition">
          CONTACT
        </button>
        <DarkModeToggle />
      </nav>
    </header>
  );
}
