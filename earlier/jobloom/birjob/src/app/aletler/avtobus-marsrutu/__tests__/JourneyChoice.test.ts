/**
 * The walk and the ride side by side (#743): the two buttons that choose which answer the
 * steps and the map show, and the mark on the journey shown. Both components run as
 * written, their icons stand-ins.
 */
import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { mountComponent, type FoundElement } from '@/test/clientComponent';
import type { RouteResult } from '@/lib/busroute/types';
import * as geo from '@/lib/busroute/geo';
import * as types from '@/lib/busroute/types';
import * as journeyFormatting from '../journeyFormatting';
import * as segmentColors from '../segmentColors';
import { choiceDetail, onFoot } from '../journeyFormatting';

const icons = new Proxy({}, { get: () => () => null });
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'string' || typeof node === 'number' ? String(node)
  : (node as FoundElement | null)?.props ? text((node as FoundElement).props.children) : '';

const stop = (id: number) => ({ id, code: '', name: `Stop ${id}`, latitude: 40.4, longitude: 49.85, is_transport_hub: false });
const segment = (mode: 'bus' | 'walk' | 'metro', time: number, distance: number) => ({
  mode, busId: mode === 'walk' ? -1 : 7, busNumber: mode === 'walk' ? '' : '7', direction: mode === 'bus' ? 1 : null,
  stops: [stop(1), stop(2)], time, distance,
});
const journey = (segments: ReturnType<typeof segment>[]): RouteResult => ({
  segments, totalTime: segments.reduce((t, s) => t + s.time, 0), totalDistance: segments.reduce((d, s) => d + s.distance, 0),
  totalTransfers: Math.max(0, segments.filter(s => s.mode !== 'walk').length - 1), totalStops: 2,
} as unknown as RouteResult);
const RIDE = journey([segment('walk', 2, 0.1), segment('bus', 9.4, 3), segment('walk', 1, 0.05)]);
const WALK = journey([segment('walk', 21.3, 1.23)]);

describe('JourneyChoice (#743)', () => {
  const FILE = fileURLToPath(new URL('../JourneyChoice.tsx', import.meta.url));
  const mount = () => mountComponent<Record<string, unknown>>(FILE, { 'lucide-react': icons, './journeyFormatting': journeyFormatting });

  it('says a walk\'s minutes and length, and that a ride\'s leave the wait out', () => {
    expect(onFoot(WALK)).toBe(true);
    expect(onFoot(RIDE)).toBe(false);
    expect(choiceDetail(WALK)).toBe('≈ 21 dəq · 1.2 km');
    expect(choiceDetail(RIDE)).toBe('≈ 12 dəq + gözləmə');
  });

  it('puts the planner\'s answer first, the one shown pressed, and tells which is chosen', () => {
    const view = mount();
    const onShow = vi.fn();
    view.render({ route: RIDE, alternative: WALK, shown: 'route', onShow });
    const buttons = () => view.find(el => el.type === 'button');
    expect(buttons().map(b => [text(b.props.children), b.props['aria-pressed']])).toEqual([
      ['Nəqliyyatla≈ 12 dəq + gözləmə', true], ['Piyada≈ 21 dəq · 1.2 km', false],
    ]);
    buttons()[1].props.onClick();
    expect(onShow).toHaveBeenCalledWith('alternative');
    view.render({ route: WALK, alternative: RIDE, shown: 'alternative', onShow });
    expect(buttons().map(b => [text(b.props.children), b.props['aria-pressed']])).toEqual([
      ['Piyada≈ 21 dəq · 1.2 km', false], ['Nəqliyyatla≈ 12 dəq + gözləmə', true],
    ]);
    expect(view.find(el => el.props.role === 'group')[0].props['aria-label']).toBe('Nəqliyyatla və ya piyada');
  });
});

describe('the journey shown beside another (#743)', () => {
  const FILE = fileURLToPath(new URL('../JourneyView.tsx', import.meta.url));
  const badge = (props: Record<string, unknown>) => {
    const view = mountComponent<Record<string, unknown>>(FILE, {
      'lucide-react': icons, '@/lib/busroute/types': types, '@/lib/busroute/geo': geo,
      './segmentColors': segmentColors, './journeyFormatting': journeyFormatting,
    });
    view.render(props);
    return text(view.find(el => el.type === 'span' && /rounded-full px-2\.5/.test(String(el.props.className)))[0].props.children);
  };

  it('marks the planner\'s answer recommended and the other the alternative, and one answer as before', () => {
    expect(badge({ route: RIDE })).toBe('Tövsiyə olunan');
    expect(badge({ route: WALK })).toBe('Piyada');
    expect(badge({ route: WALK, recommended: true })).toBe('Tövsiyə olunan');
    expect(badge({ route: RIDE, recommended: false })).toBe('Alternativ');
    // Neither recommended: only what each is.
    expect(badge({ route: RIDE, recommended: null })).toBe('Nəqliyyatla');
    expect(badge({ route: WALK, recommended: null })).toBe('Piyada');
  });
});
