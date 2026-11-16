const trackerOrigin = 'https://jasontinuk-8.github.io';
const departureBoard = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepartureBoard/';
const stationCode = /^[A-Z]{3}$/;

function json(body, status, headers) {
  return Response.json(body, { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { Vary: 'Origin', 'Cache-Control': 'no-store' };
    if (origin && origin !== trackerOrigin) {
      return json({ error: 'Origin not allowed' }, 403, headers);
    }
    if (origin) headers['Access-Control-Allow-Origin'] = origin;

    const url = new URL(request.url);
    if (url.pathname !== '/departures') {
      return json({ error: 'Not found' }, 404, headers);
    }
    if (request.method !== 'GET') {
      headers.Allow = 'GET';
      return json({ error: 'Method not allowed' }, 405, headers);
    }

    const from = (url.searchParams.get('from') ?? '').trim().toUpperCase();
    const to = (url.searchParams.get('to') ?? '').trim().toUpperCase();
    if (!stationCode.test(from) || (to && (!stationCode.test(to) || from === to))) {
      return json({ error: 'Enter valid, different three-letter station codes' }, 400, headers);
    }
    if (!env.DARWIN_API_KEY) {
      return json({ error: 'Set DARWIN_API_KEY in the Worker secrets' }, 503, headers);
    }

    const upstream = new URL(departureBoard + from);
    upstream.searchParams.set('numRows', '3');
    if (to) {
      upstream.searchParams.set('filterCrs', to);
      upstream.searchParams.set('filterType', 'to');
    }
    try {
      const response = await fetch(upstream, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LondonTransportTracker/1.0',
          'x-apikey': env.DARWIN_API_KEY
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      });
      if (response.status === 401 || response.status === 403) {
        return json({ error: 'Rail Data Marketplace rejected the Worker key' }, 502, headers);
      }
      if (!response.ok) {
        return json({ error: 'National Rail could not return this departure board' }, 502, headers);
      }
      const board = await response.json();
      if (board.crs !== from || board.areServicesAvailable === false) {
        return json({ error: 'National Rail departure information is unavailable' }, 502, headers);
      }
      const departures = (board.trainServices ?? []).slice(0, 3).map(service => ({
        destination: (service.destination ?? []).map(stop => stop.locationName).filter(Boolean).join(' / '),
        operator: service.operator ?? null,
        scheduled: service.std ?? null,
        expected: service.etd ?? null,
        platform: service.platform ?? null,
        cancelled: service.isCancelled === true || /^cancelled$/i.test(service.etd ?? '')
      }));
      return json({ station: board.locationName, from, to: to || null, departures }, 200, headers);
    } catch {
      return json({ error: 'National Rail departure information is temporarily unavailable' }, 502, headers);
    }
  }
};
