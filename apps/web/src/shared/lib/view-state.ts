export const VIEW_STORAGE_KEY = 'pltr:view:2';

export interface SavedView {
  from: number;
  to: number;
  priceScaleWidth?: number;
  paneStretch?: number[];
  /** Earliest loaded bar (seconds) when the view was saved — used to restore history depth */
  earliestBar?: number;
}

export function loadSavedView(): SavedView | null {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<SavedView>;
    if (typeof parsed.from !== 'number' || typeof parsed.to !== 'number') return null;
    const out: SavedView = { from: parsed.from, to: parsed.to };
    if (typeof parsed.priceScaleWidth === 'number') {
      out.priceScaleWidth = parsed.priceScaleWidth;
    }
    if (Array.isArray(parsed.paneStretch)) {
      const stretch = parsed.paneStretch.filter((v): v is number => typeof v === 'number');
      if (stretch.length > 0) out.paneStretch = stretch;
    }
    if (typeof parsed.earliestBar === 'number') {
      out.earliestBar = parsed.earliestBar;
    }
    return out;
  } catch {
    return null;
  }
}

export function saveView(view: SavedView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // storage unavailable (private mode etc.) — view persistence is best-effort
  }
}
