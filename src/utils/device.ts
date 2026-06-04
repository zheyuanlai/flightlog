import type { SyncDevice } from '../types'

const DEVICE_ID_KEY = 'flightlog-device-id'
const DEVICE_NAME_KEY = 'flightlog-device-name'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function fallbackDeviceName(userAgent = ''): string {
  const ua = userAgent.toLowerCase()
  if (ua.includes('iphone')) return 'iPhone'
  if (ua.includes('ipad')) return 'iPad'
  if (ua.includes('android')) return 'Android device'
  if (ua.includes('mac')) return 'Mac browser'
  if (ua.includes('windows')) return 'Windows browser'
  return 'This browser'
}

export function getOrCreateDeviceId(storage: StorageLike = window.localStorage): string {
  const existing = storage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const next = crypto.randomUUID()
  storage.setItem(DEVICE_ID_KEY, next)
  return next
}

export function getDeviceName(storage: StorageLike = window.localStorage, userAgent = navigator.userAgent): string {
  return storage.getItem(DEVICE_NAME_KEY) ?? fallbackDeviceName(userAgent)
}

export function setDeviceName(name: string, storage: StorageLike = window.localStorage): string {
  const cleaned = name.trim().slice(0, 80)
  storage.setItem(DEVICE_NAME_KEY, cleaned)
  return cleaned
}

export function currentDeviceSnapshot(options: {
  deviceId: string
  deviceName?: string
  userAgent?: string
  now?: string
}): SyncDevice {
  const now = options.now ?? new Date().toISOString()
  return {
    deviceId: options.deviceId,
    deviceName: options.deviceName?.trim() || fallbackDeviceName(options.userAgent ?? ''),
    userAgent: options.userAgent,
    lastSeenAt: now,
    updatedAt: now,
    isCurrent: true,
  }
}
