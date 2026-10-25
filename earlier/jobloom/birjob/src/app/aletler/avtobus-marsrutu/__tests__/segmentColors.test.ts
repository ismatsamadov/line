import { describe, expect, it } from 'vitest';
import type { RouteResult } from '@/lib/busroute/types';
import { segmentColors, WALK_COLOR } from '../segmentColors';

const segment = (mode: 'bus' | 'metro' | 'walk', color?: string) => ({ mode, ...(color ? { line: { name: 'Yaşıl xətt', color } } : {}) });

describe('segmentColors', () => {
  it("gives a train its line's colour, and the buses the palette in order as before the metro (#689)", () => {
    // The express bus (a bus with a metro line) is drawn as a bus.
    const route = { segments: [
      segment('walk'), segment('bus'), segment('metro', '#41A317'), segment('walk'), segment('bus'), segment('bus', '#41A317'),
    ] } as unknown as RouteResult;
    expect(segmentColors(route)).toEqual([WALK_COLOR, '#e11d48', '#41A317', WALK_COLOR, '#7c3aed', '#059669']);
  });
});
