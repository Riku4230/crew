import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

const NODE_WIDTH = 280;
const NODE_HEIGHT = 100;

interface LayoutOptions {
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
  nodeSpacing?: number;
  rankSpacing?: number;
}

/**
 * Calculate node positions using dagre layout algorithm
 * @param nodes - Array of React Flow nodes
 * @param edges - Array of React Flow edges
 * @param options - Layout options
 * @returns Nodes with updated positions
 */
export function getLayoutedElements<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node<T>[] {
  const {
    direction = 'LR',
    nodeSpacing = 50,
    rankSpacing = 100,
  } = options;

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // Configure the layout
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: nodeSpacing,
    ranksep: rankSpacing,
    marginx: 50,
    marginy: 50,
  });

  // Add nodes to the graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  // Add edges to the graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate the layout
  dagre.layout(dagreGraph);

  // Apply the calculated positions to nodes
  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    if (!nodeWithPosition) return node;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });
}

export { NODE_WIDTH, NODE_HEIGHT };

// Swimlane layout constants
const LANE_HEADER_HEIGHT = 40;
const LANE_PADDING = 20;
const LANE_GAP = 30;

export interface SwimlaneLane {
  genreId: string | null;
  genreName: string;
  genreColor: string;
  y: number;
  height: number;
  nodeIds: string[];
}

export interface SwimlaneLayoutResult<T extends Record<string, unknown>> {
  nodes: Node<T>[];
  lanes: SwimlaneLane[];
  totalHeight: number;
}

interface GenreInfo {
  id: string;
  name: string;
  color: string;
  position: number;
}

/**
 * Calculate node positions using swimlane layout based on outgoing edge genres
 * Tasks are grouped into lanes based on the genre of their outgoing dependencies
 * @param nodes - Array of React Flow nodes
 * @param edges - Array of React Flow edges with genre info in data
 * @param genres - Array of genres sorted by position
 * @param options - Layout options
 * @returns Nodes with updated positions and lane information
 */
export function getSwimlaneLayoutedElements<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  genres: GenreInfo[],
  options: LayoutOptions = {}
): SwimlaneLayoutResult<T> {
  const {
    direction = 'LR',
    nodeSpacing = 50,
    rankSpacing = 100,
  } = options;

  // Build a map of task -> outgoing edge genre
  // A task's lane is determined by its outgoing dependencies' genre
  const taskOutgoingGenres = new Map<string, string | null>();

  edges.forEach((edge) => {
    const sourceId = edge.source;
    const genreId = (edge.data as { genreId?: string | null })?.genreId ?? null;

    // If a task has multiple outgoing edges with different genres,
    // use the first one (or the one with highest priority genre)
    if (!taskOutgoingGenres.has(sourceId)) {
      taskOutgoingGenres.set(sourceId, genreId);
    }
  });

  // Group nodes by their lane (genre)
  const laneGroups = new Map<string | null, Node<T>[]>();

  // Initialize lanes for all genres plus "no genre" lane
  laneGroups.set(null, []);
  genres.forEach((genre) => {
    laneGroups.set(genre.id, []);
  });

  nodes.forEach((node) => {
    const genreId = taskOutgoingGenres.get(node.id) ?? null;
    const group = laneGroups.get(genreId);
    if (group) {
      group.push(node);
    } else {
      // If genre not found, put in "no genre" lane
      laneGroups.get(null)?.push(node);
    }
  });

  // Calculate layout for each lane separately
  const lanes: SwimlaneLane[] = [];
  let currentY = 0;
  const layoutedNodes: Node<T>[] = [];

  // Process "no genre" lane first
  const noGenreNodes = laneGroups.get(null) ?? [];
  if (noGenreNodes.length > 0) {
    const laneHeight = calculateLaneHeight(noGenreNodes, direction);
    const laneNodes = layoutNodesInLane(
      noGenreNodes,
      edges,
      currentY + LANE_HEADER_HEIGHT + LANE_PADDING,
      direction,
      nodeSpacing,
      rankSpacing
    );
    layoutedNodes.push(...laneNodes);

    lanes.push({
      genreId: null,
      genreName: 'No Genre',
      genreColor: '#808080',
      y: currentY,
      height: laneHeight + LANE_HEADER_HEIGHT + LANE_PADDING * 2,
      nodeIds: noGenreNodes.map((n) => n.id),
    });

    currentY += laneHeight + LANE_HEADER_HEIGHT + LANE_PADDING * 2 + LANE_GAP;
  }

  // Process genre lanes in order
  genres.forEach((genre) => {
    const genreNodes = laneGroups.get(genre.id) ?? [];
    if (genreNodes.length > 0) {
      const laneHeight = calculateLaneHeight(genreNodes, direction);
      const laneNodes = layoutNodesInLane(
        genreNodes,
        edges.filter((e) => genreNodes.some((n) => n.id === e.source || n.id === e.target)),
        currentY + LANE_HEADER_HEIGHT + LANE_PADDING,
        direction,
        nodeSpacing,
        rankSpacing
      );
      layoutedNodes.push(...laneNodes);

      lanes.push({
        genreId: genre.id,
        genreName: genre.name,
        genreColor: genre.color,
        y: currentY,
        height: laneHeight + LANE_HEADER_HEIGHT + LANE_PADDING * 2,
        nodeIds: genreNodes.map((n) => n.id),
      });

      currentY += laneHeight + LANE_HEADER_HEIGHT + LANE_PADDING * 2 + LANE_GAP;
    }
  });

  return {
    nodes: layoutedNodes,
    lanes,
    totalHeight: currentY - LANE_GAP, // Remove last gap
  };
}

function calculateLaneHeight<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  direction: string
): number {
  if (nodes.length === 0) return NODE_HEIGHT;

  if (direction === 'LR' || direction === 'RL') {
    // For horizontal layout, height is determined by vertical spread
    // Minimum height is one row of nodes
    return NODE_HEIGHT;
  } else {
    // For vertical layout, height is determined by number of levels
    return nodes.length * (NODE_HEIGHT + 50);
  }
}

function layoutNodesInLane<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  laneY: number,
  direction: string,
  nodeSpacing: number,
  rankSpacing: number
): Node<T>[] {
  if (nodes.length === 0) return [];

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: nodeSpacing,
    ranksep: rankSpacing,
    marginx: 50,
    marginy: 0,
  });

  // Add nodes to the graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  // Add edges (only edges between nodes in this lane)
  const nodeIds = new Set(nodes.map((n) => n.id));
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      dagreGraph.setEdge(edge.source, edge.target);
    }
  });

  // Calculate the layout
  dagre.layout(dagreGraph);

  // Apply the calculated positions to nodes with lane Y offset
  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    if (!nodeWithPosition) return node;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: laneY + (nodeWithPosition.y - NODE_HEIGHT / 2),
      },
    };
  });
}
