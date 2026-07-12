import React from 'react';

import { mineruPolygonToPercentRect } from './block-highlight';

export function PdfBlockHighlightLayer({ polygon }: { polygon?: number[] }) {
  const rect = mineruPolygonToPercentRect(polygon);
  if (!rect) return null;
  return (
    <div className="pdf-block-highlight-layer" aria-hidden="true">
      <div
        className="pdf-block-highlight"
        style={{
          left: `${rect.left}%`,
          top: `${rect.top}%`,
          width: `${rect.width}%`,
          height: `${rect.height}%`,
        }}
      />
    </div>
  );
}
