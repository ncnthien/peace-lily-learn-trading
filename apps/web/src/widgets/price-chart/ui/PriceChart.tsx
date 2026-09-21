'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BaselineSeries,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type LogicalRange,
  type UTCTimestamp,
} from 'lightweight-charts';
import { MoveHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import type {
  CandleWithIndicators,
  SupportResistanceLevel,
  Timeframe,
} from '@workspace/shared';
import { loadSavedView, saveView } from '@/shared/lib/view-state';
import {
  PositionBoxesPrimitive,
  hitTestBox,
  type BoxHandleKind,
  type PositionBox,
  type PositionBoxSide,
} from '../lib/position-boxes';
import type { PositionBoxDraft, PositionBoxUpdates } from '@/entities/position-box';

interface PriceChartProps {
  candles: CandleWithIndicators[];
  interval: Timeframe;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  boxes: PositionBox[];
  srLevels?: SupportResistanceLevel[];
  showSr: boolean;
  onToggleSr: () => void;
  depthReady: boolean;
  onCreateBox: (draft: PositionBoxDraft) => void;
  onBoxChange: (id: string, updates: PositionBoxUpdates) => void;
  onBoxCommit: (id: string, updates: PositionBoxUpdates) => void;
  onBoxRemove: (id: string) => void;
}

type RsiLineKey = 'rsi' | 'emaRsi' | 'wmaRsi';

function toLineData(
  candles: CandleWithIndicators[],
  key: RsiLineKey,
): LineData<UTCTimestamp>[] {
  const out: LineData<UTCTimestamp>[] = [];
  for (const c of candles) {
    const value = c[key];
    if (value !== null) {
      out.push({ time: (c.openTime / 1000) as UTCTimestamp, value });
    }
  }
  return out;
}

export function PriceChart({
  candles,
  interval,
  onLoadOlder,
  loadingOlder,
  boxes,
  srLevels,
  showSr,
  onToggleSr,
  depthReady,
  onCreateBox,
  onBoxChange,
  onBoxCommit,
  onBoxRemove,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaRsiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const wmaRsiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiBandRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const loadOlderRef = useRef(onLoadOlder);
  const loadingOlderRef = useRef(loadingOlder);
  const fittedRef = useRef(false);
  const firstTimeRef = useRef<number | null>(null);
  const barCountRef = useRef(0);
  const boxesRef = useRef<PositionBox[]>([]);
  const candlesRef = useRef<CandleWithIndicators[]>([]);
  const dragRef = useRef<{ id: string; handle: BoxHandleKind } | null>(null);
  const restoredChartRef = useRef<IChartApi | null>(null);
  const primitiveRef = useRef<PositionBoxesPrimitive | null>(null);
  const [placement, setPlacement] = useState<PositionBoxSide | null>(null);
  const placementRef = useRef<PositionBoxSide | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onCreateBox, onBoxChange, onBoxCommit, onBoxRemove });

  useEffect(() => {
    primitiveRef.current?.setSelectedId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    boxesRef.current = boxes;
    primitiveRef.current?.setBoxes(boxes);
  }, [boxes]);

  const srLinesRef = useRef<IPriceLine[]>([]);
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of srLinesRef.current) series.removePriceLine(line);
    srLinesRef.current = [];
    if (!showSr) return;
    for (const level of srLevels ?? []) {
      srLinesRef.current.push(
        series.createPriceLine({
          price: level.price,
          color: level.kind === 'support' ? '#10b981' : '#ef4444',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title:
            level.touches > 1
              ? `${level.kind === 'support' ? 'S' : 'R'}×${level.touches}`
              : '',
        }),
      );
    }
  }, [srLevels, candles, showSr]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    loadOlderRef.current = onLoadOlder;
  });

  useEffect(() => {
    loadingOlderRef.current = loadingOlder;
  });

  useEffect(() => {
    callbacksRef.current = { onCreateBox, onBoxChange, onBoxCommit, onBoxRemove };
  });

  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);

  useEffect(() => {
    fittedRef.current = false;
    firstTimeRef.current = null;
  }, [interval]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      height: 560,
      layout: {
        background: { color: '#0f172a' },
        textColor: '#94a3b8',
        panes: { separatorColor: '#334155', separatorHoverColor: '#475569' },
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#1e293b',
      },
      rightPriceScale: { borderColor: '#1e293b' },
      crosshair: { mode: 1 },
    });

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    rsiRef.current = chart.addSeries(
      LineSeries,
      { color: '#a855f7', lineWidth: 1, priceLineVisible: false },
      1,
    );
    emaRsiRef.current = chart.addSeries(
      LineSeries,
      { color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    wmaRsiRef.current = chart.addSeries(
      LineSeries,
      { color: '#facc15', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      1,
    );

    // Translucent purple zone between the 30 and 70 RSI levels:
    // baseline line pinned at 30, base level at 70 → fill spans exactly 30–70
    rsiBandRef.current = chart.addSeries(
      BaselineSeries,
      {
        lineVisible: false,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        baseValue: { type: 'price', price: 70 },
        topLineColor: 'rgba(168, 85, 247, 0)',
        topFillColor1: 'rgba(168, 85, 247, 0.12)',
        topFillColor2: 'rgba(168, 85, 247, 0.12)',
        bottomLineColor: 'rgba(168, 85, 247, 0)',
        bottomFillColor1: 'rgba(168, 85, 247, 0.12)',
        bottomFillColor2: 'rgba(168, 85, 247, 0.12)',
      },
      1,
    );

    const rsiSeries = rsiRef.current;
    for (const level of [30, 70]) {
      rsiSeries.createPriceLine({
        price: level,
        color: '#64748b',
        lineWidth: 1,
        lineStyle: 2 satisfies LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      });
    }

    const panes = chart.panes();
    const savedView = loadSavedView();
    panes[0]?.setStretchFactor(savedView?.paneStretch?.[0] ?? 2);
    panes[1]?.setStretchFactor(savedView?.paneStretch?.[1] ?? 1);

    const primitive = new PositionBoxesPrimitive();
    candleSeriesRef.current?.attachPrimitive(primitive);
    primitiveRef.current = primitive;
    // The boxes-sync effect runs before the chart exists on mount — push
    // the already-loaded boxes into the primitive now.
    primitive.setBoxes(boxesRef.current);

    chartRef.current = chart;

    const getMousePos = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const currentChart = chartRef.current;
      const currentSeries = candleSeriesRef.current;
      if (currentChart === null || currentSeries === null) return;
      const { x, y } = getMousePos(e);

      const side = placementRef.current;
      if (side !== null) {
        const ts = currentChart.timeScale();
        const logical = ts.coordinateToLogical(x);
        const price = currentSeries.coordinateToPrice(y);
        if (logical === null || price === null) return;
        let best: CandleWithIndicators | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const c of candlesRef.current) {
          const idx = ts.timeToIndex((c.openTime / 1000) as UTCTimestamp, true);
          if (idx === null) continue;
          const distance = Math.abs(Number(idx) - Number(logical));
          if (distance < bestDistance) {
            bestDistance = distance;
            best = c;
          }
        }
        if (best === null) return;
        const entryPrice = Number(price);
        callbacksRef.current.onCreateBox({
          side,
          entryOpenTime: best.openTime,
          bars: 20,
          entryPrice,
          stopPrice: side === 'long' ? entryPrice * 0.995 : entryPrice * 1.005,
          tpPrice: side === 'long' ? entryPrice * 1.01 : entryPrice * 0.99,
        });
        setPlacement(null);
        e.preventDefault();
        return;
      }

      const hit = hitTestBox(boxesRef.current, x, y, currentChart, currentSeries);
      if (hit !== null) {
        setSelectedId(hit.box.id);
        if (hit.handle !== 'body') {
          dragRef.current = { id: hit.box.id, handle: hit.handle };
          currentChart.applyOptions({ handleScroll: false, handleScale: false });
          e.preventDefault();
        }
        return;
      }
      if (selectedIdRef.current !== null) setSelectedId(null);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const currentChart = chartRef.current;
      const currentSeries = candleSeriesRef.current;
      if (currentChart === null || currentSeries === null) return;
      const { x, y } = getMousePos(e);
      const drag = dragRef.current;
      if (drag === null) {
        if (placementRef.current !== null) {
          el.style.cursor = 'crosshair';
          return;
        }
        const hit = hitTestBox(boxesRef.current, x, y, currentChart, currentSeries);
        if (hit === null) {
          el.style.cursor = '';
        } else if (hit.handle === 'body') {
          el.style.cursor = 'pointer';
        } else {
          el.style.cursor = hit.handle === 'end' ? 'ew-resize' : 'ns-resize';
        }
        return;
      }
      const ts = currentChart.timeScale();
      if (drag.handle === 'end') {
        const logical = ts.coordinateToLogical(x);
        const anchorOpenTime = boxesRef.current.find((b) => b.id === drag.id)?.entryOpenTime;
        if (logical !== null && anchorOpenTime !== undefined) {
          const anchor = ts.timeToIndex((anchorOpenTime / 1000) as UTCTimestamp, true);
          if (anchor !== null) {
            const newBars = Math.max(1, Math.round(Number(logical) - Number(anchor)));
            callbacksRef.current.onBoxChange(drag.id, { bars: newBars });
          }
        }
        return;
      }
      const price = currentSeries.coordinateToPrice(y);
      if (price === null) return;
      const newPrice = Number(price);
      if (drag.handle === 'entry') callbacksRef.current.onBoxChange(drag.id, { entryPrice: newPrice });
      if (drag.handle === 'stop') callbacksRef.current.onBoxChange(drag.id, { stopPrice: newPrice });
      if (drag.handle === 'tp') callbacksRef.current.onBoxChange(drag.id, { tpPrice: newPrice });
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (drag === null) {
        // Covers drags that don't move the time scale: pane separator,
        // price-scale width, box handles
        scheduleSaveView();
        return;
      }
      const latest = boxesRef.current.find((b) => b.id === drag.id);
      if (latest !== undefined) {
        if (drag.handle === 'entry') {
          callbacksRef.current.onBoxCommit(latest.id, { entryPrice: latest.entryPrice });
        } else if (drag.handle === 'stop') {
          callbacksRef.current.onBoxCommit(latest.id, { stopPrice: latest.stopPrice });
        } else if (drag.handle === 'tp') {
          callbacksRef.current.onBoxCommit(latest.id, { tpPrice: latest.tpPrice });
        } else {
          callbacksRef.current.onBoxCommit(latest.id, { bars: latest.bars });
        }
      }
      dragRef.current = null;
      chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
      scheduleSaveView();
    };

    const handleContextMenu = (e: MouseEvent) => {
      const currentChart = chartRef.current;
      const currentSeries = candleSeriesRef.current;
      if (currentChart === null || currentSeries === null) return;
      const { x, y } = getMousePos(e);
      const hit = hitTestBox(boxesRef.current, x, y, currentChart, currentSeries);
      if (hit !== null) {
        e.preventDefault();
        callbacksRef.current.onBoxRemove(hit.box.id);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (placementRef.current !== null) setPlacement(null);
        else if (selectedIdRef.current !== null) setSelectedId(null);
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedIdRef.current !== null) {
        e.preventDefault();
        callbacksRef.current.onBoxRemove(selectedIdRef.current);
        setSelectedId(null);
      }
    };

    el.addEventListener('mousedown', handleMouseDown);
    el.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const captureView = () => {
      // Never capture while the layout is still settling (tiny width produces
      // degenerate 1-2 bar ranges that would overwrite the real saved view)
      if (el.clientWidth < 100) return null;
      // Only save once the initial restore has settled on this chart instance
      if (restoredChartRef.current !== chart) return null;
      const range = chart.timeScale().getVisibleRange();
      if (range === null) return null;
      const view = {
        from: Number(range.from),
        to: Number(range.to),
        priceScaleWidth: candleSeriesRef.current?.priceScale().width(),
        paneStretch: chart.panes().map((p) => p.getStretchFactor()),
        earliestBar:
          candlesRef.current[0] !== undefined
            ? candlesRef.current[0].openTime / 1000
            : undefined,
      };
      return view;
    };
    const scheduleSaveView = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const view = captureView();
        if (view !== null) saveView(view);
      }, 300);
    };

    const handleRangeChange = (range: LogicalRange | null) => {
      if (range !== null && range.from < 5 && !loadingOlderRef.current) {
        loadOlderRef.current?.();
      }
      scheduleSaveView();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);

    const handleBeforeUnload = () => {
      const view = captureView();
      if (view !== null) saveView(view);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    const handleResize = () => chart.applyOptions({ width: el.clientWidth });
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      el.removeEventListener('mousedown', handleMouseDown);
      el.removeEventListener('contextmenu', handleContextMenu);
      if (saveTimer !== null) clearTimeout(saveTimer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      rsiRef.current = null;
      emaRsiRef.current = null;
      wmaRsiRef.current = null;
      rsiBandRef.current = null;
      primitiveRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    const data: CandlestickData[] = candles.map((c) => ({
      time: (c.openTime / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const firstTime = data.length > 0 ? (data[0].time as number) : null;
    const willPrepend =
      firstTime !== null &&
      firstTimeRef.current !== null &&
      firstTime < firstTimeRef.current;

    // Capture the viewport by TIME before prepending — time anchors survive
    // the logical index shift caused by prepending older candles.
    const restoreRange = willPrepend ? chart.timeScale().getVisibleRange() : null;

    // setData snaps the view to the right edge — remember where we were so we
    // can restore it (unless we were already at the right edge, where
    // following the newest data is the desired behavior)
    const logicalBefore = chart.timeScale().getVisibleLogicalRange();
    const atRightEdge =
      logicalBefore === null || logicalBefore.to >= barCountRef.current - 1.5;
    const timeRangeBefore = chart.timeScale().getVisibleRange();

    candleSeries.setData(data);
    rsiRef.current?.setData(toLineData(candles, 'rsi'));
    emaRsiRef.current?.setData(toLineData(candles, 'emaRsi'));
    wmaRsiRef.current?.setData(toLineData(candles, 'wmaRsi'));
    rsiBandRef.current?.setData(
      candles.map((c) => ({ time: (c.openTime / 1000) as UTCTimestamp, value: 30 })),
    );

    const restoreSavedViewOrFit = () => {
      restoredChartRef.current = chart;
      fittedRef.current = true;
      const saved = loadSavedView();
      if (saved !== null) {
        const applySavedView = () => {
          if (chartRef.current !== chart) return;
          chart.timeScale().setVisibleRange({
            from: saved.from as UTCTimestamp,
            to: saved.to as UTCTimestamp,
          });
          const stretch = saved.paneStretch;
          if (stretch !== undefined) {
            const panes = chart.panes();
            panes[0]?.setStretchFactor(stretch[0] ?? 2);
            panes[1]?.setStretchFactor(stretch[1] ?? 1);
          }
          if (typeof saved.priceScaleWidth === 'number') {
            chart
              .priceScale('right')
              .applyOptions({ minimumWidth: saved.priceScaleWidth });
          }
        };
        applySavedView();
        requestAnimationFrame(applySavedView);
      } else {
        chart.timeScale().fitContent();
      }
    };

    if (restoreRange !== null) {
      if (restoredChartRef.current !== chart && depthReady) {
        // The depth-restore pages arrive as prepends and would otherwise
        // swallow the first-settled-paint restore — restore the saved view
        // as soon as depth is ready, even mid-prepend
        restoreSavedViewOrFit();
      } else {
        chart.timeScale().setVisibleRange(restoreRange);
      }
    } else if (restoredChartRef.current !== chart && data.length > 0) {
      if (depthReady) {
        restoreSavedViewOrFit();
      }
      // depthReady false: keep the default view; saves stay blocked until the
      // history depth restore finishes loading older pages
    } else if (!atRightEdge && timeRangeBefore !== null) {
      // Data refresh (poll) — keep the user's viewport instead of snapping
      chart.timeScale().setVisibleRange(timeRangeBefore);
    } else if (!fittedRef.current && data.length > 0) {
      chart.timeScale().fitContent();
      fittedRef.current = true;
    }

    barCountRef.current = data.length;
    firstTimeRef.current = firstTime;
  }, [candles, depthReady]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 px-1 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-purple-500" /> RSI 14
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-blue-500" /> EMA of RSI (9)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-yellow-400" /> WMA of RSI (45)
        </span>
        {placement !== null && (
          <span className="ml-auto text-slate-500">
            Click the chart to place · Esc to cancel
          </span>
        )}
        {placement === null && selectedId !== null && (
          <span className="ml-auto text-slate-500">
            Backspace to delete · Esc to deselect
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            title="Place Long box (then click the chart)"
            onClick={() => {
              setPlacement((prev) => (prev === 'long' ? null : 'long'));
              setSelectedId(null);
            }}
            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border transition-colors ${
              placement === 'long'
                ? 'border-slate-500 bg-slate-600 text-slate-100'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <TrendingUp size={16} />
          </button>
          <button
            type="button"
            title="Place Short box (then click the chart)"
            onClick={() => {
              setPlacement((prev) => (prev === 'short' ? null : 'short'));
              setSelectedId(null);
            }}
            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border transition-colors ${
              placement === 'short'
                ? 'border-slate-500 bg-slate-600 text-slate-100'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <TrendingDown size={16} />
          </button>
          <div className="my-1 h-px w-5 bg-slate-700" />
          <button
            type="button"
            title="Toggle support/resistance lines"
            onClick={() => onToggleSr()}
            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border transition-colors ${
              showSr
                ? 'border-slate-500 bg-slate-600 text-slate-100'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <MoveHorizontal size={16} />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div ref={containerRef} className="w-full" />
        </div>
      </div>
    </div>
  );
}
