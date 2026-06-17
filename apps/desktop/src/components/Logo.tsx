// Same 24×24 pixel design as the .ico, rendered inline so it stays crisp
// and doesn't pull in a build asset.

const ROWS = [
  '........................',
  '........................',
  '..........IIIIII........',
  '.........I......I.......',
  '.......IIIIIIIIIIII.....',
  '......ILLLLLLLLLLLLI....',
  '......IPPPPPWPPPPPPI....',
  '......IDDDDDDDDDDDDI....',
  '........................',
  '.....IIIIIIIIIIIIIIII...',
  '....ILLLLLLLLLLLLLLLLI..',
  '....IPPPIIPPPPPIIPPPPI..',
  '....IPPPIIPPPPPIIPPPPI..',
  '....IPPPPPPPPPPPPPPPPI..',
  '....IPPPPPIIIIIIPPPPPI..',
  '....IPPPPPPIIIIPPPPPPI..',
  '....IPPPPPPPPPPPPPPPPI..',
  '....IPPPPPPPPPPPPPPPPI..',
  '....IPPPPPPPPPPPPPPPPI..',
  '....IDDDDDDDDDDDDDDDDI..',
  '.....IIIIIIIIIIIIIIII...',
  '........................',
  '........................',
  '........................',
];

const COLOR: Record<string, string> = {
  I: '#150818',
  L: '#ffd0e0',
  P: '#ff6fa8',
  D: '#e23f86',
  W: '#ffffff',
};

const CELLS: { x: number; y: number; c: string }[] = (() => {
  const out: { x: number; y: number; c: string }[] = [];
  for (let y = 0; y < ROWS.length; y++) {
    const row = ROWS[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch && COLOR[ch]) out.push({ x, y, c: COLOR[ch] });
    }
  }
  return out;
})();

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden>
      {CELLS.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={1} height={1} fill={p.c} />
      ))}
    </svg>
  );
}