import type {
  IChartApi,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';

export type PositionBoxSide = 'long' | 'short';

export interface PositionBox {
  id: string;
  side: PositionBoxSide;
  /** Anchor bar (left edge), ms epoch open time */
  entryOpenTime: number;
  /** Box width in bars, extending right from the anchor */
  bars: number;
  entryPrice: number;
  stopPrice: number;
  tpPrice: number;
}

export type BoxHandleKind = 'entry' | 'stop' | 'tp' | 'end' | 'body';

export interface BoxGeometry {
  x1: number;
  x2: number;
  yEntry: number;
  yStop: number;
  yTp: number;
}

export function boxGeometry(
  box: PositionBox,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
): BoxGeometry | null {
  const ts = chart.timeScale();
  const anchor = ts.timeToIndex((box.entryOpenTime / 1000) as UTCTimestamp, true);
  if (anchor === null) return null;
  const x1 = ts.logicalToCoordinate(Number(anchor) as unknown as Logical);
  const x2 = ts.logicalToCoordinate((Number(anchor) + box.bars) as unknown as Logical);
  const yEntry = series.priceToCoordinate(box.entryPrice);
  const yStop = series.priceToCoordinate(box.stopPrice);
  const yTp = series.priceToCoordinate(box.tpPrice);
  if (x1 === null || x2 === null || yEntry === null || yStop === null || yTp === null) {
    return null;
  }
  return { x1, x2, yEntry, yStop, yTp };
}

export function riskReward(box: PositionBox): number | null {
  const risk =
    box.side === 'long' ? box.entryPrice - box.stopPrice : box.stopPrice - box.entryPrice;
  const reward =
    box.side === 'long' ? box.tpPrice - box.entryPrice : box.entryPrice - box.tpPrice;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

export function hitTestBox(
  boxes: PositionBox[],
  x: number,
  y: number,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
): { box: PositionBox; handle: BoxHandleKind } | null {
  const tolerance = 6;
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i];
    const g = boxGeometry(box, chart, series);
    if (g === null) continue;
    const left = Math.min(g.x1, g.x2);
    const right = Math.max(g.x1, g.x2);
    const top = Math.min(g.yEntry, g.yStop, g.yTp);
    const bottom = Math.max(g.yEntry, g.yStop, g.yTp);
    const withinX = x >= left - tolerance && x <= right + tolerance;
    if (withinX && Math.abs(y - g.yStop) <= tolerance) return { box, handle: 'stop' };
    if (withinX && Math.abs(y - g.yTp) <= tolerance) return { box, handle: 'tp' };
    if (withinX && Math.abs(y - g.yEntry) <= tolerance) return { box, handle: 'entry' };
    if (
      Math.abs(x - right) <= tolerance &&
      y >= top - tolerance &&
      y <= bottom + tolerance
    ) {
      return { box, handle: 'end' };
    }
    if (x >= left && x <= right && y >= top && y <= bottom) {
      return { box, handle: 'body' };
    }
  }
  return null;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  color: string,
  dashed = false,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (dashed) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x1, Math.round(y) + 0.5);
  ctx.lineTo(x2, Math.round(y) + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawHandleDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.save();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export function drawPositionBox(
  ctx: CanvasRenderingContext2D,
  box: PositionBox,
  g: BoxGeometry,
  selected = false,
): void {
  const left = Math.min(g.x1, g.x2);
  const right = Math.max(g.x1, g.x2);

  const profitTop = Math.min(g.yEntry, g.yTp);
  const profitHeight = Math.abs(g.yTp - g.yEntry);
  ctx.fillStyle = selected ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.15)';
  ctx.fillRect(left, profitTop, right - left, profitHeight);

  const riskTop = Math.min(g.yEntry, g.yStop);
  const riskHeight = Math.abs(g.yStop - g.yEntry);
  ctx.fillStyle = selected ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.15)';
  ctx.fillRect(left, riskTop, right - left, riskHeight);

  if (selected) {
    const top = Math.min(g.yEntry, g.yStop, g.yTp);
    const bottom = Math.max(g.yEntry, g.yStop, g.yTp);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.setLineDash([]);
  }

  drawLine(ctx, left, right, g.yTp, '#10b981');
  drawLine(ctx, left, right, g.yStop, '#ef4444');
  drawLine(ctx, left, right, g.yEntry, '#94a3b8', true);

  drawHandleDot(ctx, left, g.yTp, '#10b981');
  drawHandleDot(ctx, left, g.yStop, '#ef4444');
  drawHandleDot(ctx, left, g.yEntry, '#94a3b8');
  drawHandleDot(ctx, right, g.yEntry, '#94a3b8');

  const rr = riskReward(box);
  const label = rr === null ? 'R:R —' : `R:R ${rr.toFixed(2)}`;
  const chipX = left + 6;
  const chipY = Math.min(g.yEntry, g.yStop, g.yTp) + 6;
  ctx.save();
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  const textWidth = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.beginPath();
  ctx.roundRect(chipX, chipY, textWidth + 10, 18, 4);
  ctx.fill();
  ctx.strokeStyle = rr === null ? '#64748b' : box.side === 'long' ? '#10b981' : '#ef4444';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(label, chipX + 5, chipY + 13);
  ctx.restore();
}

export class PositionBoxesPrimitive implements ISeriesPrimitive<Time> {
  private boxes: PositionBox[] = [];
  private selectedId: string | null = null;
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;

  setBoxes(boxes: PositionBox[]): void {
    this.boxes = boxes;
    this.requestUpdate?.();
  }

  setSelectedId(id: string | null): void {
    this.selectedId = id;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  updateAllViews(): void {}

  paneViews(): IPrimitivePaneView[] {
    return [
      {
        zOrder: () => 'top',
        renderer: () => ({
          draw: (target) => {
            target.useMediaCoordinateSpace((scope) => {
              if (this.chart === null || this.series === null) return;
              for (const box of this.boxes) {
                const g = boxGeometry(box, this.chart, this.series);
                if (g !== null) {
                  drawPositionBox(scope.context, box, g, box.id === this.selectedId);
                }
              }
            });
          },
        }),
      },
    ];
  }
}
