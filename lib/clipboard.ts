/**
 * Copies text to the clipboard.
 *
 * `navigator.clipboard` only exists in a secure context, and this app is served
 * over plain HTTP on the LAN on purpose — so there is a `execCommand` fallback
 * that still works there. Returns whether the copy happened.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sin permisos o sin contexto seguro: se intenta el método clásico.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';

    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);

    return copied;
  } catch {
    return false;
  }
}
