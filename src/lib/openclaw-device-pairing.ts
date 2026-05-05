import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'
import { logger } from './logger'

const OPENCLAW_DEVICE_PAIRING_MODULE =
  '/usr/local/lib/node_modules/openclaw/dist/device-pairing-BKGoKi3X.js'
const dynamicImport = new Function(
  'modulePath',
  'return import(modulePath)',
) as (modulePath: string) => Promise<unknown>

type DeviceTokenSummary = {
  role: string
  scopes?: string[]
  createdAtMs?: number
  rotatedAtMs?: number
  revokedAtMs?: number
  lastUsedAtMs?: number
}

type PendingDevice = {
  requestId: string
  deviceId: string
  displayName?: string
  platform?: string
  clientId?: string
  clientMode?: string
  role?: string
  roles?: string[]
  scopes?: string[]
  remoteIp?: string
  isRepair?: boolean
  ts?: number
}

type PairedDevice = {
  deviceId: string
  displayName?: string
  publicKey?: string
  platform?: string
  clientId?: string
  clientMode?: string
  role?: string
  roles?: string[]
  scopes?: string[]
  remoteIp?: string
  createdAtMs?: number
  approvedAtMs?: number
  tokens?: Record<string, unknown>
}

type LocalDevicePairingModule = {
  c: (baseDir?: string) => Promise<{ pending: PendingDevice[]; paired: PairedDevice[] }>
  h: (tokens?: Record<string, unknown>) => DeviceTokenSummary[]
  i: (result: Record<string, unknown>) => string
  n: (
    requestId: string,
    options?: { callerScopes?: string[] },
    baseDir?: string,
  ) => Promise<Record<string, unknown> | null>
  u: (requestId: string, baseDir?: string) => Promise<Record<string, unknown> | null>
}

async function importLocalDevicePairingModule(): Promise<LocalDevicePairingModule | null> {
  if (!fs.existsSync(OPENCLAW_DEVICE_PAIRING_MODULE)) return null
  try {
    return (await dynamicImport(OPENCLAW_DEVICE_PAIRING_MODULE)) as LocalDevicePairingModule
  } catch (err) {
    logger.warn({ err }, 'Failed to import OpenClaw local device pairing module')
    return null
  }
}

function canReadLocalPairingStore(): boolean {
  const devicesDir = path.join(config.openclawStateDir, 'devices')
  if (!fs.existsSync(devicesDir)) return false
  try {
    fs.accessSync(devicesDir, fs.constants.R_OK | fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function redactPairedDevice(
  device: PairedDevice,
  summarizeDeviceTokens: (tokens?: Record<string, unknown>) => DeviceTokenSummary[],
) {
  const { tokens, ...rest } = device
  return {
    ...rest,
    id: device.deviceId,
    displayName: device.displayName || device.deviceId,
    tokens: summarizeDeviceTokens(tokens),
  }
}

export function canUseLocalDevicePairingFallback(): boolean {
  return canReadLocalPairingStore() && fs.existsSync(OPENCLAW_DEVICE_PAIRING_MODULE)
}

export async function listLocalDevicePairing() {
  if (!canUseLocalDevicePairingFallback()) return null
  const mod = await importLocalDevicePairingModule()
  if (!mod) return null

  const local = await mod.c(config.openclawStateDir)
  return {
    pending: Array.isArray(local.pending) ? local.pending : [],
    paired: Array.isArray(local.paired)
      ? local.paired.map((device) => redactPairedDevice(device, mod.h))
      : [],
  }
}

export async function approveLocalDevicePairing(requestId: string) {
  if (!canUseLocalDevicePairingFallback()) return null
  const mod = await importLocalDevicePairingModule()
  if (!mod) return null

  const result = await mod.n(
    requestId,
    { callerScopes: ['operator.admin'] },
    config.openclawStateDir,
  )
  if (!result) return null

  if (result.status === 'forbidden') {
    return {
      status: 'forbidden' as const,
      message: mod.i(result),
    }
  }

  const device = result.device as PairedDevice | undefined
  return {
    status: 'approved' as const,
    requestId,
    device: device ? redactPairedDevice(device, mod.h) : undefined,
  }
}

export async function rejectLocalDevicePairing(requestId: string) {
  if (!canUseLocalDevicePairingFallback()) return null
  const mod = await importLocalDevicePairingModule()
  if (!mod) return null
  return await mod.u(requestId, config.openclawStateDir)
}
