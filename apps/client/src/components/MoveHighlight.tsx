import React, { useEffect, useRef } from 'react';
import './MoveHighlight.css';

interface MoveHighlightProps {
  from: string;
  to: string;
  boardFlipped?: boolean;
}

export const MoveHighlight: React.FC<MoveHighlightProps> = ({ from, to, boardFlipped = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const SQ = 12.5;
    const HALF = SQ / 2;
    const color = '#dc2626'; // Red

    function getPos(square: string) {
      const file = square.charCodeAt(0) - 96;
      const rank = parseInt(square[1]);
      return {
        x: (boardFlipped ? 8 - file : file - 1) * SQ,
        y: (boardFlipped ? rank - 1 : 8 - rank) * SQ,
      };
    }

    const fromPos = getPos(from);
    const toPos = getPos(to);

    // Create border divs
    const fromBorder = document.createElement('div');
    fromBorder.className = 'move-highlight-border';
    fromBorder.style.cssText = `
      position: absolute;
      width: ${SQ}%;
      height: ${SQ}%;
      left: ${fromPos.x}%;
      top: ${fromPos.y}%;
      border: 3px solid ${color};
      border-radius: 4px;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 10;
    `;

    const toBorder = document.createElement('div');
    toBorder.className = 'move-highlight-border';
    toBorder.style.cssText = `
      position: absolute;
      width: ${SQ}%;
      height: ${SQ}%;
      left: ${toPos.x}%;
      top: ${toPos.y}%;
      border: 3px solid ${color};
      border-radius: 4px;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 10;
    `;

    // Calculate arrow
    const fromCx = fromPos.x + HALF;
    const fromCy = fromPos.y + HALF;
    const toCx = toPos.x + HALF;
    const toCy = toPos.y + HALF;

    const dx = toCx - fromCx;
    const dy = toCy - fromCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / dist;
    const ny = dy / dist;

    const offset = Math.min(HALF, dist * 0.25);

    const x1 = fromCx + nx * offset;
    const y1 = fromCy + ny * offset;
    const x2 = toCx - nx * offset;
    const y2 = toCy - ny * offset;

    // Create SVG arrow
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 11;
    `;

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', `arrow-${from}-${to}`);
    marker.setAttribute('markerWidth', '2.5');
    marker.setAttribute('markerHeight', '2.5');
    marker.setAttribute('refX', '1.25');
    marker.setAttribute('refY', '1.25');
    marker.setAttribute('orient', 'auto');

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0 0, 2.5 1.25, 0 2.5');
    poly.setAttribute('fill', color);

    marker.appendChild(poly);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1.toString());
    line.setAttribute('y1', y1.toString());
    line.setAttribute('x2', x2.toString());
    line.setAttribute('y2', y2.toString());
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1.2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', `url(#arrow-${from}-${to})`);

    svg.appendChild(line);

    // Append to container
    containerRef.current.appendChild(fromBorder);
    containerRef.current.appendChild(toBorder);
    containerRef.current.appendChild(svg);

    // Cleanup
    return () => {
      fromBorder.remove();
      toBorder.remove();
      svg.remove();
    };
  }, [from, to, boardFlipped]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
};
