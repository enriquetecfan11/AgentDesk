/**
 * Small cross-component signals used by the application shell.
 *
 * The topbar and the sidebar need to open the command palette, which lives in
 * the layout. Rather than lift state into a context provider for two buttons,
 * they dispatch a window event.
 */

export const COMMAND_PALETTE_EVENT = 'agentdesk:command-palette';
export const CAPTURE_EVENT = 'agentdesk:capture';

function dispatch(name: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(name));
}

/** Opens the palette in command mode. */
export function openCommandPalette() {
  dispatch(COMMAND_PALETTE_EVENT);
}

/** Opens the palette in capture mode (same as pressing `c`). */
export function openCapture() {
  dispatch(CAPTURE_EVENT);
}
