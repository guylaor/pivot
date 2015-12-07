'use strict';
require('./histogram.css');

import { List } from 'immutable';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as d3 from 'd3';
import { $, ply, Expression, RefExpression, Executor, Dataset, Datum, TimeRange, SortAction } from 'plywood';
import { listsEqual } from '../../../common/utils/general/general';
import { formatterFromData } from '../../../common/utils/formatter/formatter';
import { Stage, Filter, Essence, VisStrategy, Splits, SplitCombine, Dimension, Measure, Colors, DataSource, Clicker, VisualizationProps, Resolve } from '../../../common/models/index';
import { SPLIT, SEGMENT, TIME_SEGMENT } from '../../config/constants';
import { getXFromEvent, getYFromEvent } from '../../utils/dom/dom';
import { SvgIcon } from '../../components/svg-icon/svg-icon';
import { HighlightControls } from '../../components/highlight-controls/highlight-controls';
import { Loader } from '../../components/loader/loader';
import { QueryError } from '../../components/query-error/query-error';

/*
import { $, Expression, Executor, Dataset } from 'plywood';
// import { ... } from '../../config/constants';
import { Stage, Clicker, Essence, DataSource, Filter, Splits, Dimension, Measure, Colors, VisualizationProps, Resolve } from '../../../common/models/index';
// import { SomeComp } from '../some-comp/some-comp';
*/
const H_PADDING = 10;
const TEXT_SPACER = 36;
const X_AXIS_HEIGHT = 30;
const Y_AXIS_WIDTH = 60;
const MIN_GRAPH_HEIGHT = 140;
const MAX_GRAPH_WIDTH = 2000;
const HOVER_BUBBLE_V_OFFSET = -8;
const HOVER_BUBBLE_HEIGHT = 50;
const MAX_HOVER_DIST = 50;

const HEADER_HEIGHT = 38;
const SEGMENT_WIDTH = 300;
const INDENT_WIDTH = 25;
const MEASURE_WIDTH = 100;
const ROW_HEIGHT = 30;
const SPACE_LEFT = 10;
const SPACE_RIGHT = 10;

const ROW_PADDING_RIGHT = 50;
const BODY_PADDING_BOTTOM = 90;

const HIGHLIGHT_CONTROLS_TOP = -34;

function formatSegment(value: any): string {
  if (TimeRange.isTimeRange(value)) {
    return value.start.toISOString();
  }
  return String(value);
}

function getFilterFromDatum(splits: Splits, flatDatum: Datum): Filter {
  if (flatDatum['__nest'] === 0) return null;
  var segments: any[] = [];
  while (flatDatum['__nest'] > 0) {
    segments.unshift(flatDatum[SEGMENT]);
    flatDatum = flatDatum['__parent'];
  }
  return new Filter(List(segments.map((segment, i) => {
    return splits.get(i).expression.in(TimeRange.isTimeRange(segment) ? segment : [segment]);
  })));
}

export interface PositionHover {
  what: string;
  measure?: Measure;
  row?: Datum;
}

export interface HistogramState {
  loading?: boolean;
  dataset?: Dataset;
  error?: any;
  flatData?: Datum[];
  scrollLeft?: number;
  scrollTop?: number;
  hoverMeasure?: Measure;
  hoverRow?: Datum;
}

export class Histogram extends React.Component<VisualizationProps, HistogramState> {
  static id = 'histogram';
  static title = 'Histogram';

  static handleCircumstance(dataSource: DataSource, splits: Splits, colors: Colors, current: boolean): Resolve {
    // Must have at least one dimension
    if (splits.length() === 0) {
      var someDimensions = dataSource.dimensions.toArray().filter(d => d.type !== 'TIME').slice(0, 2);
      return Resolve.manual(4, 'This visualization requires at least one split',
        someDimensions.map((someDimension) => {
          return {
            description: `Add a split on ${someDimension.title}`,
            adjustment: {
              splits: Splits.fromSplitCombine(SplitCombine.fromExpression(someDimension.expression))
            }
          };
        })
      );
    }

    // Auto adjustment
    var autoChanged = false;
    splits = splits.map((split, i) => {
      var splitDimension = dataSource.getDimensionByExpression(split.expression);

      if (!split.sortAction) {
        split = split.changeSortAction(dataSource.getDefaultSortAction());
        autoChanged = true;
      } else if (split.sortAction.refName() === TIME_SEGMENT) {
        split = split.changeSortAction(new SortAction({
          expression: $(SEGMENT),
          direction: split.sortAction.direction
        }));
        autoChanged = true;
      }

      // ToDo: review this
      if (!split.limitAction && (autoChanged || splitDimension.type !== 'TIME')) {
        split = split.changeLimit(i ? 5 : 50);
        autoChanged = true;
      }

      return split;
    });

    if (colors) {
      colors = null;
      autoChanged = true;
    }

    return autoChanged ? Resolve.automatic(6, { splits }) : Resolve.ready(10);
  }


  public mounted: boolean;

  constructor() {
    super();
    this.state = {
      loading: false,
      dataset: null,
      error: null,
      flatData: null,
      scrollLeft: 0,
      scrollTop: 0,
      hoverMeasure: null,
      hoverRow: null
    };

  }


  fetchData(essence: Essence): void {
    var { splits, dataSource } = essence;
    var measures = essence.getMeasures();

    var $main = $('main');

    var query = ply()
      .apply('main', $main.filter(essence.getEffectiveFilter(Histogram.id).toExpression()));

    measures.forEach((measure) => {
      query = query.performAction(measure.toApplyAction());
    });

    function makeQuery(i: number): Expression {
      var split = splits.get(i);
      var { sortAction, limitAction } = split;
      if (!sortAction) throw new Error('something went wrong in table query generation');

      var subQuery = $main.split(split.toSplitExpression(), SEGMENT);

      measures.forEach((measure) => {
        subQuery = subQuery.performAction(measure.toApplyAction());
      });

      var applyForSort = essence.getApplyForSort(sortAction);
      if (applyForSort) {
        subQuery = subQuery.performAction(applyForSort);
      }
      subQuery = subQuery.performAction(sortAction);

      if (limitAction) {
        subQuery = subQuery.performAction(limitAction);
      }

      if (i + 1 < splits.length()) {
        subQuery = subQuery.apply(SPLIT, makeQuery(i + 1));
      }

      return subQuery;
    }

    query = query.apply(SPLIT, makeQuery(0));

    this.setState({ loading: true });
    dataSource.executor(query)
      .then(
        (dataset) => {
          if (!this.mounted) return;
          this.setState({
            loading: false,
            dataset,
            error: null,
            flatData: dataset.flatten({
              order: 'preorder',
              nestingName: '__nest',
              parentName: '__parent'
            })
          });
        },
        (error) => {
          if (!this.mounted) return;
          this.setState({
            loading: false,
            dataset: null,
            error,
            flatData: null
          });
        }
      );
  }


  componentDidMount() {
    this.mounted = true;
    var { essence } = this.props;
    this.fetchData(essence);

  }

  componentDidUpdate() {

    /*
      var { clicker, essence, stage } = this.props;
      var { loading, error, flatData, scrollLeft, scrollTop, hoverMeasure, hoverRow, dataset } = this.state;
      var { splits } = essence;

      var segmentTitle = splits.getTitle(essence.dataSource.dimensions);
      var commonSort = essence.getCommonSort();
      var commonSortName = commonSort ? (commonSort.expression as RefExpression).name : null;

      var sortArrowIcon = commonSort ? React.createElement(SvgIcon, {
        svg: require('../../icons/sort-arrow.svg'),
        className: 'sort-arrow ' + commonSort.direction
      }) : null;

      var cornerSortArrow: JSX.Element = null;
      if (commonSortName === SEGMENT) {
        cornerSortArrow = sortArrowIcon;
      }
      var measuresArray = essence.getMeasures().toArray();

      // chart starts from here
      var numberOfColumns = Math.ceil(stage.width / MAX_GRAPH_WIDTH);
      var measureGraphs: Array<JSX.Element>;
      var getX = 1; //(d: Datum) => midpoint(d[TIME_SEGMENT]);
      var measures = essence.getMeasures().toArray();
      console.log("measures", measures);

      var parentWidth = stage.width - H_PADDING * 2;
      var graphHeight = Math.max(MIN_GRAPH_HEIGHT, Math.floor((stage.height - X_AXIS_HEIGHT) / measures.length));
      var svgStage = new Stage({
        x: H_PADDING,
        y: 0,
        width: Math.floor(parentWidth / numberOfColumns),
        height: graphHeight - 1 // -1 for border
      });

      var scaleX = d3.time.scale()
      ////guy  .domain([timeRange.start, timeRange.end])
        .range([0, svgStage.width - Y_AXIS_WIDTH]);

      var xTicks = scaleX.ticks();

      measureGraphs = measures.map((measure, chartIndex) => {
        return this.renderChart(dataset, measure, chartIndex, stage, svgStage, getX, scaleX, xTicks);
      });
      */
    }

  componentWillUnmount() {
    this.mounted = false;
  }

  componentWillReceiveProps(nextProps: VisualizationProps) {
    var { essence } = this.props;
    var nextEssence = nextProps.essence;
    if (
      nextEssence.differentDataSource(essence) ||
      nextEssence.differentEffectiveFilter(essence, Histogram.id) ||
      nextEssence.differentSplits(essence) ||
      nextEssence.newSelectedMeasures(essence)
    ) {
      this.fetchData(nextEssence);
    }
  }


  onScroll(e: UIEvent) {
    var target = e.target as Element;
    this.setState({
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop
    });
  }

  calculateMousePosition(e: MouseEvent): PositionHover {
    var { essence } = this.props;
    var { flatData, scrollLeft, scrollTop } = this.state;
    var rect = ReactDOM.findDOMNode(this.refs['base']).getBoundingClientRect();
    var x = getXFromEvent(e) - rect.left;
    var y = getYFromEvent(e) - rect.top;

    if (x <= SPACE_LEFT) return { what: 'space-left' };
    x -= SPACE_LEFT;

    if (y <= HEADER_HEIGHT) {
      if (x <= SEGMENT_WIDTH) return { what: 'corner' };

      x = x - SEGMENT_WIDTH + scrollLeft;
      var measureIndex = Math.floor(x / MEASURE_WIDTH);
      var measure = essence.getMeasures().get(measureIndex);
      if (!measure) return { what: 'whitespace' };
      return { what: 'header', measure };
    }

    y = y - HEADER_HEIGHT + scrollTop;
    var rowIndex = Math.floor(y / ROW_HEIGHT);
    var datum = flatData ? flatData[rowIndex] : null;
    if (!datum) return { what: 'whitespace' };
    return { what: 'row', row: datum };
  }

  onMouseLeave() {
    var { hoverMeasure, hoverRow } = this.state;
    if (hoverMeasure || hoverRow) {
      this.setState({
        hoverMeasure: null,
        hoverRow: null
      });
    }
  }

  onMouseMove(e: MouseEvent) {
    var { hoverMeasure, hoverRow } = this.state;
    var pos = this.calculateMousePosition(e);
    if (hoverMeasure !== pos.measure || hoverRow !== pos.row) {
      this.setState({
        hoverMeasure: pos.measure,
        hoverRow: pos.row
      });
    }
  }

  onClick(e: MouseEvent) {
    var { clicker, essence } = this.props;
    var pos = this.calculateMousePosition(e);

    if (pos.what === 'corner' || pos.what === 'header') {
      var sortExpression = $(pos.what === 'corner' ? SEGMENT : pos.measure.name);
      var commonSort = essence.getCommonSort();
      var myDescending = (commonSort && commonSort.expression.equals(sortExpression) && commonSort.direction === SortAction.DESCENDING);
      clicker.changeSplits(essence.splits.changeSortAction(new SortAction({
        expression: sortExpression,
        direction: myDescending ? SortAction.ASCENDING : SortAction.DESCENDING
      })), VisStrategy.KeepAlways);

    } else if (pos.what === 'row') {
      var rowHighlight = getFilterFromDatum(essence.splits, pos.row);

      if (essence.highlightOn(Histogram.id)) {
        if (rowHighlight.equals(essence.highlight.delta)) {
          clicker.dropHighlight();
          return;
        }
      }

      clicker.changeHighlight(Histogram.id, rowHighlight);
    }
  }


  renderChart(dataset: Dataset, measure: Measure, graphIndex: number, stage: Stage, svgStage: Stage, getX: any, scaleX: any, xTicks: Date[]): JSX.Element {

    console.group("renderChart");
    console.log("Dataset", dataset);
    console.log("measure", Measure);
    console.log("graphIndex", graphIndex);
    console.log("stage", stage);
    console.log("xTicks", xTicks);
    console.groupEnd();
    var chartID = "BarChart" + graphIndex;


    if (!dataset) {
      return <div><svg id={chartID} className="chart"></svg></div>;
    }
    var measureName = measure.name;
    var myDatum: Datum = dataset.data[0];
    var myDataset: Dataset = myDatum[SPLIT];
    var getY = (d: Datum) => d[measureName];
    console.log("myDataSet", myDataset);
    var  data = myDataset.data;

    // A formatter for counts.
    var formatCount = d3.format(",.0f");

    var margin = {top: 10, right: 30, bottom: 30, left: 30},
        width = stage.width - margin.left - margin.right,
        height = ( stage.height / dataset.attributes.length);
        //height = ( stage.height / dataset.attributes.length) - margin.top - margin.bottom; //


    var x = d3.scale.ordinal()
        .rangeRoundBands([0, width], .1);

    var y = d3.scale.linear()
        .range([height, 0]);

    var xAxis = d3.svg.axis()
        .scale(x)
        .orient("bottom");

    var yAxis = d3.svg.axis()
        .scale(y)
        .orient("left");

    var chart = d3.select( "#" + chartID ).html("");

    chart = d3.select( "#" + chartID )
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
      .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    //var data = values;

    x.domain(data.map(function(d) { return d['SEGMENT']; }));
    y.domain([0, d3.max(data, function(d) { return getY(d); })]);

    chart.append("g")
        .attr("class", "x axis")
        .attr("transform", "translate(0," + height + ")")
        .call(xAxis);

    chart.append("g")
        .attr("class", "y axis")
        .call(yAxis);

    chart.selectAll(".bar")
        .data(data)
      .enter().append("rect")
        .attr("class", "bar")
        .attr("x", function(d) { return x(d['SEGMENT']); })
        .attr("y", function(d) { return y(getY(d)); })
        .attr("height", function(d) { return height - y(getY(d)); })
        .attr("width", x.rangeBand());

    return <div key={measureName} >
            <div className="measure-label">
              <span className="measure-title">{measure.title}</span>
              <span className="colon">: </span>
              <span className="measure-value">{measure.formatFn(myDatum[measureName])}</span>
            </div>
            <svg id={chartID} className="chart"></svg></div>;
  }

  type(d: any) {
    d.value = +d.value; // coerce to number
    return d;
  }

  render() {
    console.log("Histogram", this.props, this.state);

    var { clicker, essence, stage } = this.props;
    var { loading, error, flatData, scrollLeft, scrollTop, hoverMeasure, hoverRow, dataset } = this.state;
    var { splits } = essence;

    var segmentTitle = splits.getTitle(essence.dataSource.dimensions);
    var commonSort = essence.getCommonSort();
    var commonSortName = commonSort ? (commonSort.expression as RefExpression).name : null;

    var sortArrowIcon = commonSort ? React.createElement(SvgIcon, {
      svg: require('../../icons/sort-arrow.svg'),
      className: 'sort-arrow ' + commonSort.direction
    }) : null;

    var cornerSortArrow: JSX.Element = null;
    if (commonSortName === SEGMENT) {
      cornerSortArrow = sortArrowIcon;
    }
    var measuresArray = essence.getMeasures().toArray();

    // chart starts from here
    var numberOfColumns = Math.ceil(stage.width / MAX_GRAPH_WIDTH);
    var measureGraphs: Array<JSX.Element>;
    var getX = 1; //(d: Datum) => midpoint(d[TIME_SEGMENT]);
    var measures = essence.getMeasures().toArray();
    console.log("measures", measures);

    var parentWidth = stage.width - H_PADDING * 2;
    var graphHeight = Math.max(MIN_GRAPH_HEIGHT, Math.floor((stage.height - X_AXIS_HEIGHT) / measures.length));
    var svgStage = new Stage({
      x: H_PADDING,
      y: 0,
      width: Math.floor(parentWidth / numberOfColumns),
      height: graphHeight - 1 // -1 for border
    });

    var scaleX = d3.time.scale()
    ////guy  .domain([timeRange.start, timeRange.end])
      .range([0, svgStage.width - Y_AXIS_WIDTH]);

    var xTicks = scaleX.ticks();

    measureGraphs = measures.map((measure, chartIndex) => {
      return this.renderChart(dataset, measure, chartIndex, stage, svgStage, getX, scaleX, xTicks);
    });

    var loader: JSX.Element = null;
    if (loading) {
      loader = <Loader/>;
    }

    var queryError: JSX.Element = null;
    if (error) {
      queryError = <QueryError error={error}/>;
    }

    return <div id="wrapper">
      <div id="histogram-chart">{measureGraphs}</div>

      {queryError}
      {loader}
    </div>;
  }
}
