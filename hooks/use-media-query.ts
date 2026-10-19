'use client';

import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query from React.
 *
 * Starts as `false` on the server and on the first client render so the markup
 * matches during hydration; the real value lands in the effect. Visibility that
 * must be correct before hydration (the sidebar on mobile, for instance) is
 * handled with CSS classes, never with this hook.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
