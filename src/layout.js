const isFunction = function(o){ return typeof o === 'function'; };
const defaults = require('./defaults');
const assign = require('./assign');
const dagre = require('dagre');

// constructor
// options : object containing layout options
function DagreLayout( options ){
  this.options = assign( {}, defaults, options );
}

// runs the layout
DagreLayout.prototype.run = function(){
  let options = this.options;
  let layout = this;

  let cy = options.cy; // cy is automatically populated for us in the constructor
  let eles = options.eles;

  let getVal = function( ele, val ){
    return isFunction(val) ? val.apply( ele, [ ele ] ) : val;
  };

  let bb = options.boundingBox || { x1: 0, y1: 0, w: cy.width(), h: cy.height() };
  if( bb.x2 === undefined ){ bb.x2 = bb.x1 + bb.w; }
  if( bb.w === undefined ){ bb.w = bb.x2 - bb.x1; }
  if( bb.y2 === undefined ){ bb.y2 = bb.y1 + bb.h; }
  if( bb.h === undefined ){ bb.h = bb.y2 - bb.y1; }

  let g = new dagre.graphlib.Graph({
    multigraph: true,
    compound: true
  });

  let gObj = {};
  let setGObj = function( name, val ){
    if( val != null ){
      gObj[ name ] = val;
    }
  };

  setGObj( 'nodesep', options.nodeSep );
  setGObj( 'edgesep', options.edgeSep );
  setGObj( 'ranksep', options.rankSep );
  setGObj( 'rankdir', options.rankDir );
  setGObj( 'ranker', options.ranker );

  g.setGraph( gObj );

  g.setDefaultEdgeLabel(function() { return {}; });
  g.setDefaultNodeLabel(function() { return {}; });

  // add nodes to dagre
  let nodes = eles.nodes();
  for( let i = 0; i < nodes.length; i++ ){
    let node = nodes[i];
    let nbb = node.layoutDimensions( options );

    g.setNode( node.id(), {
      width: nbb.w,
      height: nbb.h,
      name: node.id()
    } );

    // console.log( g.node(node.id()) );
  }

  // set compound parents
  for( let i = 0; i < nodes.length; i++ ){
    let node = nodes[i];

    if( node.isChild() ){
      g.setParent( node.id(), node.parent().id() );
    }
  }

  // add edges to dagre
  let edges = eles.edges().stdFilter(function( edge ){
    return !edge.source().isParent() && !edge.target().isParent(); // dagre can't handle edges on compound nodes
  });
  for( let i = 0; i < edges.length; i++ ){
    let edge = edges[i];

    g.setEdge( edge.source().id(), edge.target().id(), {
      minlen: getVal( edge, options.minLen ),
      weight: getVal( edge, options.edgeWeight ),
      name: edge.id()
    }, edge.id() );

    // console.log( g.edge(edge.source().id(), edge.target().id(), edge.id()) );
  }

  dagre.layout( g );

  let gEdgeIds = g.edges();
  for( let i = 0; i < gEdgeIds.length; i++ ){
    let id = gEdgeIds[i];
    let e = g.edge( id );

    if (e && e.points) {
      if (e.points.length > 3) {
        console.log('More than 3 points', e.points);
        let distances = [];

        let pStart = e.points[0];
        let pEnd = e.points[e.points.length - 1];

        let slope = (pEnd.y - pStart.y) / (pEnd.x - pStart.x);
        let yIntercept = pStart.y - slope * pStart.x;
        let slopeOrthogonal = -1 * (1 / slope);

        let getDistance = function(pSegment) {
          let result = {
            'distance': pSegment.x - pStart.x,
            'weight': Math.abs(pSegment.y - pStart.y) / Math.abs(pEnd.y - pStart.y)
          };

          if (pEnd.x - pStart.x === 0) {
            return result;
          }

          let y2 = pEnd.y;
          let y1 = pStart.y;
          let x2 = pEnd.x;
          let x1 = pStart.x;
          let y3 = pSegment.y;
          let x3 = pSegment.x;
          let k = ((y2-y1) * (x3-x1) - (x2-x1) * (y3-y1)) / (Math.pow((y2-y1), 2) + (Math.pow((x2-x1), 2)));
          let x4 = x3 - k * (y2-y1);
          let y4 = y3 + k * (x2-x1);

          result.distance = (Math.sqrt(Math.pow((y4-y3), 2) + Math.pow((x4-x3), 2)));

          let d = (pSegment.x - pStart.x) * (pEnd.y - pStart.y) - (pSegment.y - pStart.y) * (pEnd.x - pStart.x);
          if(d > 0) {
            result.distance = -result.distance;
          }

          let yInterceptOrthogonal = pSegment.y - (slopeOrthogonal * pSegment.x);
          let distanceOrhthogonal = (slopeOrthogonal * pStart.x - pStart.y + yInterceptOrthogonal) / (Math.sqrt(Math.pow(slopeOrthogonal, 2) + 1));

          result.weight = distanceOrhthogonal / Math.sqrt(Math.pow(pEnd.x - pStart.x, 2) + Math.pow(pEnd.y - pStart.y, 2));

          if(result.weight < 0) {
            result.weight = -result.weight;
          }

          return result;
        };

        for ( let j = 1; j < e.points.length - 1; j++) {
          distances.push(getDistance(e.points[j]));
        }

        //distances[distances.length - 1].distance = 0;
        //distances[distances.length - 1].weight = 1;
        console.log('Distances calculated', distances);

        cy.style().selector('edge#' + id.name).style('curve-style', 'segments').update();
        cy.style().selector('edge#' + id.name).style('segment-distances', distances.map(distance => distance.distance).join(' '));
        cy.style().selector('edge#' + id.name).style('segment-weights', distances.map(distance => distance.weight).join(' '));
      } else {
        console.log('Less than 3 points', e);
        cy.style().selector('edge#' + id.name).style('curve-style', 'bezier').update();
      }
    }
  }

  let gNodeIds = g.nodes();
  for( let i = 0; i < gNodeIds.length; i++ ){
    let id = gNodeIds[i];
    let n = g.node( id );

    cy.getElementById(id).scratch().dagre = n;
  }

  let dagreBB;

  if( options.boundingBox ){
    dagreBB = { x1: Infinity, x2: -Infinity, y1: Infinity, y2: -Infinity };
    nodes.forEach(function( node ){
      let dModel = node.scratch().dagre;

      dagreBB.x1 = Math.min( dagreBB.x1, dModel.x );
      dagreBB.x2 = Math.max( dagreBB.x2, dModel.x );

      dagreBB.y1 = Math.min( dagreBB.y1, dModel.y );
      dagreBB.y2 = Math.max( dagreBB.y2, dModel.y );
    });

    dagreBB.w = dagreBB.x2 - dagreBB.x1;
    dagreBB.h = dagreBB.y2 - dagreBB.y1;
  } else {
    dagreBB = bb;
  }

  let constrainPos = function( p ){
    if( options.boundingBox ){
      let xPct = dagreBB.w === 0 ? 0 : (p.x - dagreBB.x1) / dagreBB.w;
      let yPct = dagreBB.h === 0 ? 0 : (p.y - dagreBB.y1) / dagreBB.h;

      return {
        x: bb.x1 + xPct * bb.w,
        y: bb.y1 + yPct * bb.h
      };
    } else {
      return p;
    }
  };

  nodes.layoutPositions(layout, options, function( ele ){
    ele = typeof ele === "object" ? ele : this;
    let dModel = ele.scratch().dagre;

    return constrainPos({
      x: dModel.x,
      y: dModel.y
    });
  });

  return this; // chaining
};

module.exports = DagreLayout;
