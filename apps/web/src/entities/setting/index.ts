/**
 * Public API of the `setting` entity — currently only the chart-toggle
 * settings. Other user-configurable settings will join this slice when
 * they appear.
 */
export {
  useChartSettings,
  fetchSetting,
  type ChartSettings,
} from './model/use-chart-settings';
