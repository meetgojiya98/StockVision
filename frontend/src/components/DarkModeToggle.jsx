import { useState, useEffect } from 'react';

export default function DarkModeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [dark]);

  return (
    <button
      onClick={() => setDark(!dark)}
      className="ml-4 px-3 py-1 border border-accent rounded hover:bg-accent hover:text-primary transition"
      aria-label="Toggle dark mode"
    >
      {dark ? 'Light' : 'Dark'}
    </button>
  );
}
