export type CourseType = 'CM' | 'TD' | 'TP' | 'EXAM' | 'PROJECT' | 'OTHER';

export interface CourseEvent {
  id: string;
  rawTitle: string;
  title: string;
  code?: string;
  group?: string;
  type: CourseType;
  start: Date;
  end: Date;
  location: string;
  room?: string;
  building?: string;
  teacher: string;
  description: string;
  notes?: string;
  color?: string;
  // Overlap positioning helper
  colIndex?: number;
  totalCols?: number;
}

export interface Preferences {
  url: string;
  theme: 'dark' | 'slate' | 'pitch' | 'light';
  density: 'compact' | 'comfortable';
  startHour: number;
  endHour: number;
  colors: Record<string, string>;
  notes: Record<string, string>;
  lastSync?: string;
}
