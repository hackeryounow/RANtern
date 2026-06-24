import Plotly from 'plotly.js-dist-min';
import createPlotlyComponentFactory from 'react-plotly.js/factory';

// Handle CJS/ESM interop: the factory may be on .default
const factory = (typeof createPlotlyComponentFactory === 'function')
  ? createPlotlyComponentFactory
  : (createPlotlyComponentFactory as any).default;

const PlotlyLib = (Plotly as any).default ?? Plotly;

const Plot = factory(PlotlyLib);

export default Plot;
