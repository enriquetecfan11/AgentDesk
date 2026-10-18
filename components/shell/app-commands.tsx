'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { CommandPalette, NAVIGATION, type PaletteMode } from '@/components/shell/command-palette';
import { ShortcutHelp } from '@/components/shell/shortcut-help';
import { api } from '@/lib/api-client';
import { CAPTURE_EVENT, COMMAND_PALETTE_EVENT } from '@/lib/events';

/** `g` followed by one of these letters jumps to a section. */
const GO_TO: Record<string, string> = {
  i: '/inbox',
  h: '/today',
  u: '/upcoming',
  t: '/tasks',
  p: '/projects',
  n: '/notes',
  a: '/activity',
  b: '/agents',
  r: '/runs',
  s: '/settings',
};

const GO_PREFIX_TIMEOUT = 1200;

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;

  const tag = element.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    element.isContentEditable === true
  );
}

/**
 * Keyboard layer of the shell.
 *
 * Mounted once in the authenticated layout. Single-key shortcuts are ignored
 * while the focus is inside a form field, so typing a task title never
 * navigates away.
 */
export function AppCommands() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaletteMode>('command');
  const [helpOpen, setHelpOpen] = useState(false);

  const startCapture = useCallback(() => {
    setMode('capture');
    setOpen(true);
  }, []);

  // Buttons elsewhere in the shell ask for the palette through window events.
  useEffect(() => {
    function openPalette() {
      setMode('command');
      setOpen(true);
    }

    window.addEventListener(COMMAND_PALETTE_EVENT, openPalette);
    window.addEventListener(CAPTURE_EVENT, startCapture);

    return () => {
      window.removeEventListener(COMMAND_PALETTE_EVENT, openPalette);
      window.removeEventListener(CAPTURE_EVENT, startCapture);
    };
  }, [startCapture]);

  useEffect(() => {
    let pendingGo = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(event: KeyboardEvent) {
      // Cmd/Ctrl+K works everywhere, including from inside a text field.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMode('command');
        setOpen((current) => !current);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (open || helpOpen) return;
      if (isTyping(event.target)) return;

      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (event.key === 'c') {
        event.preventDefault();
        startCapture();
        return;
      }

      if (event.key === 'g') {
        pendingGo = true;
        clearTimeout(timer);
        timer = setTimeout(() => {
          pendingGo = false;
        }, GO_PREFIX_TIMEOUT);
        return;
      }

      if (pendingGo) {
        pendingGo = false;
        clearTimeout(timer);

        const href = GO_TO[event.key.toLowerCase()];
        if (href) {
          event.preventDefault();
          router.push(href);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer);
    };
  }, [open, helpOpen, router, startCapture]);

  async function signOut() {
    setOpen(false);
    await api.post('/api/auth/logout').catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <CommandPalette
        open={open}
        mode={mode}
        onOpenChange={setOpen}
        onStartCapture={() => {
          setMode('capture');
          setOpen(true);
        }}
        onShowShortcuts={() => setHelpOpen(true)}
        onSignOut={() => void signOut()}
      />

      <ShortcutHelp
        open={helpOpen}
        onOpenChange={setHelpOpen}
        navigation={NAVIGATION.map((item) => ({
          label: item.label,
          keys: item.keys,
        })).filter((item): item is { label: string; keys: string } => Boolean(item.keys))}
      />
    </>
  );
}
