/**
 * Route-handler tests for the bus line-viewer endpoints:
 *   GET /api/avtobus/buses — the picker list
 *   GET /api/avtobus/line  — one line's full trajectory (+ input validation)
 * The DB layer is mocked; these assert the routes' validation + error branches.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { queryBusLine: vi.fn(), listBusesLite: vi.fn() },
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ _json: body, status: init?.status ?? 200 }),
  },
  NextRequest: class {},
}));
vi.mock('@/lib/busroute/db', () => dbMock);

import { GET as lineGET } from '../line/route';
import { GET as busesGET } from '../buses/route';

type Res = { _json: { line?: { number: string }; buses?: unknown[]; error?: string }; status: number };

const lineReq = (qs: string) => ({ url: `http://localhost/api/avtobus/line${qs}` }) as never;

const SAMPLE_LINE = {
  busId: 1, number: '1', carrier: 'BakuBus', first_point: 'A', last_point: 'B',
  route_length: 25.8, duration_minuts: 43, tariff_str: '0.50 AZN',
  direction: 1, availableDirections: [1, 2],
  stops: [{ id: 10, code: '', name: 'A', latitude: 40.4, longitude: 49.8, is_transport_hub: false }],
  coordinates: [{ latitude: 40.4, longitude: 49.8 }, { latitude: 40.41, longitude: 49.81 }],
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/avtobus/line', () => {
  it('400 when busId is missing (no DB call)', async () => {
    const res = (await lineGET(lineReq(''))) as unknown as Res;
    expect(res.status).toBe(400);
    expect(dbMock.queryBusLine).not.toHaveBeenCalled();
  });

  it('400 when busId is non-numeric', async () => {
    const res = (await lineGET(lineReq('?busId=abc'))) as unknown as Res;
    expect(res.status).toBe(400);
    expect(dbMock.queryBusLine).not.toHaveBeenCalled();
  });

  it('404 when the line does not exist', async () => {
    dbMock.queryBusLine.mockResolvedValue(null);
    const res = (await lineGET(lineReq('?busId=99999'))) as unknown as Res;
    expect(res.status).toBe(404);
  });

  it('200 with the line and defaults the direction to 1', async () => {
    dbMock.queryBusLine.mockResolvedValue(SAMPLE_LINE);
    const res = (await lineGET(lineReq('?busId=1'))) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res._json.line?.number).toBe('1');
    expect(dbMock.queryBusLine).toHaveBeenCalledWith(1, 1);
  });

  it('passes the requested direction through', async () => {
    dbMock.queryBusLine.mockResolvedValue({ ...SAMPLE_LINE, direction: 2 });
    await lineGET(lineReq('?busId=1&direction=2'));
    expect(dbMock.queryBusLine).toHaveBeenCalledWith(1, 2);
  });

  it('falls back to direction 1 when the direction is non-numeric', async () => {
    dbMock.queryBusLine.mockResolvedValue(SAMPLE_LINE);
    await lineGET(lineReq('?busId=1&direction=xyz'));
    expect(dbMock.queryBusLine).toHaveBeenCalledWith(1, 1);
  });

  it('500 (not a throw) when the query fails — graceful degradation', async () => {
    dbMock.queryBusLine.mockRejectedValue(new Error('db down'));
    const res = (await lineGET(lineReq('?busId=1'))) as unknown as Res;
    expect(res.status).toBe(500);
  });
});

describe('GET /api/avtobus/buses', () => {
  it('200 with the bus list', async () => {
    dbMock.listBusesLite.mockResolvedValue([
      { id: 1, number: '1', first_point: 'A', last_point: 'B', route_length: 25.8, duration_minuts: 43 },
    ]);
    const res = (await busesGET()) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res._json.buses).toHaveLength(1);
  });

  it('500 (not a throw) when the query fails — graceful degradation', async () => {
    dbMock.listBusesLite.mockRejectedValue(new Error('db down'));
    const res = (await busesGET()) as unknown as Res;
    expect(res.status).toBe(500);
  });
});
