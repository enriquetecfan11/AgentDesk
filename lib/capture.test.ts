import { describe, expect, it } from 'vitest';

import { hasCaptureDetail, parseCapture } from '@/lib/capture';

/**
 * A fixed "now" makes every assertion about relative dates exact.
 * 2026-01-15 is a Thursday.
 */
const THURSDAY = new Date(2026, 0, 15, 9, 0);

function capture(input: string) {
  return parseCapture(input, THURSDAY);
}

describe('parseCapture — the documented example', () => {
  it('understands "revisar CVEs mañana 10:00 p1 #wazuh"', () => {
    const result = capture('revisar CVEs mañana 10:00 p1 #wazuh');

    expect(result.title).toBe('revisar CVEs');
    expect(result.dueDate).toBe('2026-01-16');
    expect(result.dueTime).toBe('10:00');
    expect(result.priority).toBe('urgent');
    expect(result.projectQuery).toBe('wazuh');
    expect(result.labelQueries).toEqual([]);
    expect(result.recurrence).toBeNull();
  });
});

describe('parseCapture — title', () => {
  it('keeps the words it does not understand', () => {
    expect(capture('informe trimestral el viernes').title).toBe('informe trimestral');
    expect(capture('llamar a Marina mañana').title).toBe('llamar a Marina');
  });

  it('collapses the leftover whitespace', () => {
    expect(capture('  arreglar   el   teclado  ').title).toBe('arreglar el teclado');
  });

  it('falls back to the raw text when everything was consumed', () => {
    // Rare, but a task with an empty title would be a validation error.
    expect(capture('mañana').title).toBe('mañana');
  });
});

describe('parseCapture — dates', () => {
  it('handles hoy and mañana', () => {
    expect(capture('algo hoy').dueDate).toBe('2026-01-15');
    expect(capture('algo mañana').dueDate).toBe('2026-01-16');
    expect(capture('algo pasado mañana').dueDate).toBe('2026-01-17');
  });

  it('reads a bare weekday as the next one', () => {
    // Today is Thursday; "viernes" is tomorrow, "jueves" is next week.
    expect(capture('algo el viernes').dueDate).toBe('2026-01-16');
    expect(capture('algo jueves').dueDate).toBe('2026-01-22');
  });

  it('reads ISO dates', () => {
    expect(capture('reunión 2026-03-01').dueDate).toBe('2026-03-01');
  });

  it('reads dd/mm and rolls to next year when the date has passed', () => {
    expect(capture('backup 15/02').dueDate).toBe('2026-02-15');
    expect(capture('factura 02/01').dueDate).toBe('2027-01-02');
    expect(capture('archivo 15/02/2027').dueDate).toBe('2027-02-15');
  });

  it('reads "15 de enero"', () => {
    expect(capture('renovar el 20 de marzo').dueDate).toBe('2026-03-20');
  });

  it('reads a bare day of month, this month or the next', () => {
    expect(capture('pagar el 20').dueDate).toBe('2026-01-20');
    expect(capture('pagar el 3').dueDate).toBe('2026-02-03');
  });

  it('reads relative offsets', () => {
    expect(capture('algo en 3 días').dueDate).toBe('2026-01-18');
    expect(capture('algo en 2 semanas').dueDate).toBe('2026-01-29');
    expect(capture('algo en un mes').dueDate).toBe('2026-02-15');
  });

  it('leaves the date empty when nothing is said', () => {
    expect(capture('escribir el guion del curso').dueDate).toBeNull();
  });
});

describe('parseCapture — time', () => {
  it('reads HH:MM', () => {
    expect(capture('algo 09:30').dueTime).toBe('09:30');
    expect(capture('algo a las 10:00').dueTime).toBe('10:00');
  });

  it('reads the 10h and "a las 10" forms', () => {
    expect(capture('algo 10h').dueTime).toBe('10:00');
    expect(capture('algo 10h30').dueTime).toBe('10:30');
    expect(capture('algo a las 9').dueTime).toBe('09:00');
  });

  it('does not invent a time out of a plain number', () => {
    expect(capture('comprar 2 kilos de café').dueTime).toBeNull();
  });

  it('rejects impossible clock values', () => {
    const result = capture('algo 99:99');
    expect(result.dueTime).toBeNull();
    // The characters were not understood, so they stay in the title.
    expect(result.title).toBe('algo 99:99');
  });
});

describe('parseCapture — priority', () => {
  it('maps p1..p4 to the four levels', () => {
    expect(capture('algo p1').priority).toBe('urgent');
    expect(capture('algo p2').priority).toBe('high');
    expect(capture('algo p3').priority).toBe('normal');
    expect(capture('algo p4').priority).toBe('low');
  });

  it('accepts the written forms', () => {
    expect(capture('algo !urgente').priority).toBe('urgent');
    expect(capture('algo prioridad alta').priority).toBe('high');
    expect(capture('algo !baja').priority).toBe('low');
  });

  it('defaults to none', () => {
    expect(capture('algo tranquilo').priority).toBe('none');
  });

  it('does not eat the P of a word', () => {
    expect(capture('revisar API1 y P2P').priority).toBe('none');
    expect(capture('revisar API1 y P2P').title).toBe('revisar API1 y P2P');
  });
});

describe('parseCapture — project and labels', () => {
  it('reads one project and many labels', () => {
    const result = capture('auditar servidores #wazuh @seguridad @devops');
    expect(result.projectQuery).toBe('wazuh');
    expect(result.labelQueries).toEqual(['seguridad', 'devops']);
    expect(result.title).toBe('auditar servidores');
  });

  it('keeps accents and dashes in tag names', () => {
    const result = capture('algo #diseño @front-end');
    expect(result.projectQuery).toBe('diseño');
    expect(result.labelQueries).toEqual(['front-end']);
  });
});

describe('parseCapture — recurrence', () => {
  it('reads "todos los días"', () => {
    const result = capture('standup todos los días a las 9');
    expect(result.recurrence).toBe('FREQ=DAILY');
    expect(result.dueTime).toBe('09:00');
    expect(result.title).toBe('standup');
  });

  it('reads an interval', () => {
    const result = capture('revisar logs cada 3 días');
    expect(result.recurrence).toBe('FREQ=DAILY;INTERVAL=3');
    expect(result.title).toBe('revisar logs');
  });

  it('reads weekdays', () => {
    expect(capture('gimnasio cada lunes').recurrence).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(capture('clase cada lunes y jueves').recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,TH');
    expect(capture('nóminas cada mes').recurrence).toBe('FREQ=MONTHLY');
  });

  it('does not treat a weekday phrase as a date first', () => {
    // "cada lunes" is a rule, not a due date.
    expect(capture('gimnasio cada lunes').dueDate).toBeNull();
  });
});

describe('parseCapture — everything at once', () => {
  it('parses a dense line', () => {
    const result = capture('revisar CVEs mañana 10:00 p1 #wazuh @seguridad !urgente');

    expect(result.title).toBe('revisar CVEs');
    expect(result.dueDate).toBe('2026-01-16');
    expect(result.dueTime).toBe('10:00');
    expect(result.priority).toBe('urgent');
    expect(result.projectQuery).toBe('wazuh');
    expect(result.labelQueries).toEqual(['seguridad']);
  });

  it('is order-independent', () => {
    const a = capture('#wazuh p1 mañana revisar CVEs');
    const b = capture('mañana revisar CVEs p1 #wazuh');

    expect(a.title).toBe('revisar CVEs');
    expect(a.dueDate).toBe(b.dueDate);
    expect(a.priority).toBe(b.priority);
    expect(a.projectQuery).toBe(b.projectQuery);
  });
});

describe('hasCaptureDetail', () => {
  it('is false for a plain title', () => {
    expect(hasCaptureDetail(capture('comprar café'))).toBe(false);
  });

  it('is true as soon as anything was understood', () => {
    expect(hasCaptureDetail(capture('comprar café mañana'))).toBe(true);
    expect(hasCaptureDetail(capture('comprar café p1'))).toBe(true);
    expect(hasCaptureDetail(capture('comprar café @casa'))).toBe(true);
    expect(hasCaptureDetail(capture('comprar café #hogar'))).toBe(true);
    expect(hasCaptureDetail(capture('comprar café todos los días'))).toBe(true);
  });
});
