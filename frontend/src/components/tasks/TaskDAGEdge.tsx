import { memo, useState, useEffect } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TaskDAGEdgeProps extends EdgeProps {
  data?: {
    onDelete?: (edgeId: string) => void;
    animated?: boolean;
    genreColor?: string;
    genreName?: string;
  };
}

export const TaskDAGEdge = memo(function TaskDAGEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: TaskDAGEdgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isNew, setIsNew] = useState(true);

  // Remove "new" animation state after initial render
  useEffect(() => {
    const timer = setTimeout(() => setIsNew(false), 500);
    return () => clearTimeout(timer);
  }, []);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data?.onDelete) {
      data.onDelete(id);
    }
  };

  // Calculate path length for dash animation
  const pathLength = Math.sqrt(
    Math.pow(targetX - sourceX, 2) + Math.pow(targetY - sourceY, 2)
  );

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: isHovered
            ? 'hsl(var(--destructive))'
            : isNew
              ? 'hsl(var(--primary))'
              : data?.genreColor ?? 'hsl(var(--muted-foreground))',
          strokeWidth: isHovered ? 2 : data?.genreColor ? 2 : 1.5,
          strokeDasharray: isNew ? pathLength : 'none',
          strokeDashoffset: isNew ? pathLength : 0,
          animation: isNew ? 'edge-draw 0.5s ease-out forwards' : 'none',
          transition: 'stroke 0.2s ease',
        }}
        interactionWidth={20}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
      {isHovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan flex items-center gap-1"
          >
            {data?.genreName && (
              <div
                className="px-2 py-0.5 rounded text-xs font-medium shadow-md"
                style={{
                  backgroundColor: data.genreColor ?? 'hsl(var(--muted))',
                  color: 'white',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                }}
              >
                {data.genreName}
              </div>
            )}
            {data?.onDelete && (
              <button
                onClick={handleDelete}
                className={cn(
                  'flex items-center justify-center w-5 h-5 rounded-full',
                  'bg-destructive text-destructive-foreground',
                  'hover:bg-destructive/90 transition-colors',
                  'shadow-md'
                )}
                title="Delete dependency"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
      {/* CSS keyframes for edge animation */}
      <style>
        {`
          @keyframes edge-draw {
            from {
              stroke-dashoffset: ${pathLength};
            }
            to {
              stroke-dashoffset: 0;
            }
          }
        `}
      </style>
    </>
  );
});
