declare module 'plotly.js-dist-min' {
  const Plotly: any;
  export default Plotly;
}

declare module 'react-plotly.js/factory' {
  function createPlotlyComponent(Plotly: any): React.ComponentType<any>;
  export default createPlotlyComponent;
}
