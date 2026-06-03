const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://ryanlai.github.io',
])

function corsHeaders(origin) {
  const allowedOrigin = allowedOrigins.has(origin) ? origin : 'https://ryanlai.github.io'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    },
  })
}

function validate(url) {
  const flightNumber = (url.searchParams.get('flightNumber') || '').trim().toUpperCase()
  const date = (url.searchParams.get('date') || '').trim()
  if (!/^[A-Z0-9]{2,8}$/.test(flightNumber)) return { error: 'flightNumber must be 2-8 letters or numbers' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date must be YYYY-MM-DD' }
  return { flightNumber, date }
}

function mockStatus(flightNumber, date) {
  return {
    status: 'scheduled',
    scheduledDeparture: `${date}T20:45`,
    estimatedDeparture: `${date}T20:55`,
    scheduledArrival: `${date}T23:35`,
    departureTerminal: '1',
    departureGate: 'A12',
    arrivalTerminal: 'B',
    baggageClaim: '4',
    aircraftType: 'Airbus A350-900',
    aircraftRegistration: '9V-MOCK',
    provider: 'mock-worker',
    rawProviderStatus: `Mock status for ${flightNumber}`,
  }
}

async function fetchAeroDataBoxStatus(flightNumber, date, env) {
  if (!env.AERODATABOX_API_KEY) {
    throw new Error('AERODATABOX_API_KEY is not configured')
  }

  // TODO: Confirm the exact AeroDataBox plan endpoint and normalize all edge cases.
  const endpoint = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${date}`
  const response = await fetch(endpoint, {
    headers: {
      'X-RapidAPI-Key': env.AERODATABOX_API_KEY,
      'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
    },
  })
  if (!response.ok) throw new Error(`Provider returned ${response.status}`)
  const data = await response.json()
  const first = Array.isArray(data) ? data[0] : data?.flights?.[0] ?? data
  return {
    status: first?.status?.toLowerCase?.() ?? 'unknown',
    scheduledDeparture: first?.departure?.scheduledTimeLocal,
    estimatedDeparture: first?.departure?.predictedTimeLocal,
    actualDeparture: first?.departure?.actualTimeLocal,
    scheduledArrival: first?.arrival?.scheduledTimeLocal,
    estimatedArrival: first?.arrival?.predictedTimeLocal,
    actualArrival: first?.arrival?.actualTimeLocal,
    departureTerminal: first?.departure?.terminal,
    departureGate: first?.departure?.gate,
    arrivalTerminal: first?.arrival?.terminal,
    arrivalGate: first?.arrival?.gate,
    baggageClaim: first?.arrival?.baggageBelt,
    aircraftType: first?.aircraft?.model,
    aircraftRegistration: first?.aircraft?.reg,
    provider: 'aerodatabox',
    rawProviderStatus: first?.status,
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) })
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.pathname !== '/flight-status') return json({ error: 'Not found' }, 404, origin)
    const input = validate(url)
    if (input.error) return json({ error: input.error }, 400, origin)

    const cacheKey = new Request(url.toString(), request)
    const cached = await caches.default.match(cacheKey)
    if (cached) return cached

    try {
      const status = env.MOCK_FLIGHT_STATUS === 'true'
        ? mockStatus(input.flightNumber, input.date)
        : await fetchAeroDataBoxStatus(input.flightNumber, input.date, env)
      const response = json(status, 200, origin)
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()))
      return response
    } catch (error) {
      const message = error instanceof Error && error.message.includes('configured')
        ? 'Flight status provider is not configured'
        : 'Unable to fetch flight status'
      return json({ error: message }, 500, origin)
    }
  },
}
