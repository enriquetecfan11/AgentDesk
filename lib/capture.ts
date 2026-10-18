import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';

const WEEKDAY_WORDS: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6, domingo: 0,
};

const MONTH_WORDS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

export interface ParsedCapture {
  title: string;
  dueDate: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low' | null;
  projectName: string | null;
  todayTag: boolean;
}

// Lightweight natural-language parser for quick capture lines, e.g.:
// "revisar presupuesto mañana !alta #Operaciones"
// "llamar al proveedor 24/10 !urgente"
// "preparar demo el viernes #Producto"
export function parseCapture(raw: string, today = new Date()): ParsedCapture {
  let text = raw.trim();
  const result: ParsedCapture = { title: '', dueDate: null, priority: null, projectName: null, todayTag: false };

  // Priority: !urgente !alta !normal !baja
  const priorityMatch = text.match(/!(urgente|alta|normal|baja)\b/i);
  if (priorityMatch) {
    const p = priorityMatch[1].toLowerCase();
    result.priority = p === 'urgente' ? 'urgent' : p === 'alta' ? 'high' : p === 'baja' ? 'low' : 'normal';
    text = text.replace(priorityMatch[0], '');
  }

  // Project: #Nombre
  const projectMatch = text.match(/#([\p{L}\p{N}_-]+)/u);
  if (projectMatch) {
    result.projectName = projectMatch[1];
    text = text.replace(projectMatch[0], '');
  }

  // Dates
  const lower = text.toLowerCase();

  const dateToken = lower.match(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/);
  const monthToken = lower.match(/\b(el )?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  const relativeMatch = lower.match(/\b(mañana|hoy|pasado mañana|fin de semana|el lunes|el martes|el miercoles|el miércoles|el jueves|el viernes|el sabado|el sábado|el domingo|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/);
  const inDaysMatch = lower.match(/\ben (\d+) dias?\b/);

  let date: Date | null = null;

  if (relativeMatch && relativeMatch[0] !== 'el') {
    const w = relativeMatch[1];
    if (w === 'hoy') {
      date = today;
      result.todayTag = true;
    } else if (w === 'mañana') {
      date = addDays(today, 1);
    } else if (w === 'pasado mañana') {
      date = addDays(today, 2);
    } else if (w === 'fin de semana') {
      date = addDays(today, (6 - today.getDay() + 7) % 7 || 7);
    } else {
      const weekday = WEEKDAY_WORDS[w.replace(/^el\s+/, '')];
      if (weekday !== undefined) {
        let delta = (weekday - today.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        date = addDays(today, delta);
      }
    }
  } else if (inDaysMatch) {
    date = addDays(today, parseInt(inDaysMatch[1], 10));
  } else if (dateToken) {
    const [d, m, y] = dateToken[0].split('/').map((v) => parseInt(v, 10));
    const year = y ? (y < 100 ? 2000 + y : y) : today.getFullYear();
    const parsed = new Date(year, m - 1, d);
    if (!isNaN(parsed.getTime())) date = parsed;
  } else {
    if (monthToken) {
      const day = parseInt(monthToken[2], 10);
      const month = MONTH_WORDS[monthToken[3]];
      let parsed = new Date(today.getFullYear(), month, day);
      if (parsed < today) parsed = new Date(today.getFullYear() + 1, month, day);
      date = parsed;
    }
  }
  if (date) {
    result.dueDate = format(date, 'yyyy-MM-dd');
    // strip the matched date words from the title
    if (dateToken) text = text.replace(new RegExp(dateToken[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '');
    else if (monthToken) text = text.replace(new RegExp(monthToken[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '');
    else if (relativeMatch && relativeMatch[0] !== 'el') text = text.replace(new RegExp(`\\b${relativeMatch[0]}\\b`, 'i'), '');
    else if (inDaysMatch) text = text.replace(new RegExp(`\\b${inDaysMatch[0]}\\b`, 'i'), '');
  }

  result.title = text.replace(/\s{2,}/g, ' ').replace(/\s+([!,#])/g, '$1').trim();
  if (!result.title) result.title = raw.trim();
  return result;
}

// ============ Calendar helpers ============

export function monthGrid(monthDate: Date): Date[] {
  const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });
  const days: Date[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function weekDays(weekDate: Date): Date[] {
  const start = startOfWeek(weekDate, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function fmtDayName(d: Date): string {
  return format(d, 'EEE d', { locale: es });
}

export function fmtMonth(d: Date): string {
  return format(d, 'MMMM yyyy', { locale: es });
}

export { isSameDay, isSameMonth, parseISO, format };
