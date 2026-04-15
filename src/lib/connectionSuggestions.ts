import { execFile as execFileCallback } from "node:child_process"
import { readdir } from "node:fs/promises"
import { createConnection } from "node:net"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"

const execFile = promisify(execFileCallback)
const POSTGRES_SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])
const DEFAULT_POSTGRES_PORT_FALLBACK = [5432, 5433, 5434, 5435, 5436, 5437, 5438, 5439, 5440]

export async function findLocalSqliteDatabaseFiles(directory = process.cwd()): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && isLocalSqliteDatabaseFilename(entry.name))
      .map((entry) => join(directory, entry.name))
      .toSorted((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

export function isLocalSqliteDatabaseFilename(name: string): boolean {
  if (/-wal$/i.test(name) || /-shm$/i.test(name) || /\.lock$/i.test(name)) {
    return false
  }

  return /\.sqlite/i.test(name) || /\.db/i.test(name)
}

export function localDatabaseSuggestionName(filePath: string): string {
  return `${basename(dirname(filePath))}/${basename(filePath)}`
}

export async function findLocalPostgresPorts(args: {
  fallbackPorts?: readonly number[]
  listListeningPorts?: () => Promise<number[]>
  probePort?: (port: number) => Promise<boolean>
} = {}): Promise<number[]> {
  const listListeningPorts = args.listListeningPorts ?? listLocalListeningTcpPorts
  const probePort = args.probePort ?? probePostgresPort
  const fallbackPorts = args.fallbackPorts ?? DEFAULT_POSTGRES_PORT_FALLBACK

  const listeningPorts = await listListeningPorts().catch(() => [])
  const candidatePorts = [...new Set((listeningPorts.length > 0 ? listeningPorts : fallbackPorts).filter(isValidPort))]
    .sort((left, right) => left - right)

  const probeResults = await Promise.all(
    candidatePorts.map(async (port) => ((await probePort(port)) ? port : undefined)),
  )

  return probeResults.filter((port): port is number => port !== undefined)
}

export async function listLocalListeningTcpPorts(): Promise<number[]> {
  const commands = [
    { file: "lsof", args: ["-nP", "-iTCP", "-sTCP:LISTEN"] },
    { file: "netstat", args: ["-an"] },
  ] as const

  for (const command of commands) {
    try {
      const { stdout } = await execFile(command.file, command.args, {
        maxBuffer: 1024 * 1024,
        timeout: 1500,
      })
      const ports = parseListeningTcpPorts(stdout)
      if (ports.length > 0) {
        return ports
      }
    } catch {
      // Ignore missing tools or unsupported platforms and fall back below.
    }
  }

  return []
}

export function parseListeningTcpPorts(output: string): number[] {
  const ports = new Set<number>()

  for (const line of output.split(/\r?\n/)) {
    if (!/\bLISTEN\b/i.test(line)) {
      continue
    }

    const matches = [...line.matchAll(/[:.](\d+)(?=(?:\s|\)|$))/g)]
    const port = Number(matches.at(-1)?.[1] ?? NaN)
    if (isValidPort(port)) {
      ports.add(port)
    }
  }

  return [...ports].sort((left, right) => left - right)
}

export async function probePostgresPort(
  port: number,
  args: {
    host?: string
    timeoutMs?: number
  } = {},
): Promise<boolean> {
  const host = args.host ?? "127.0.0.1"
  const timeoutMs = args.timeoutMs ?? 150

  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port })
    let settled = false

    const finish = (result: boolean) => {
      if (settled) {
        return
      }

      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once("connect", () => {
      socket.write(POSTGRES_SSL_REQUEST)
    })
    socket.once("data", (chunk) => {
      const response = chunk[0]
      finish(response === 0x53 || response === 0x4e)
    })
    socket.once("timeout", () => finish(false))
    socket.once("error", () => finish(false))
    socket.once("end", () => finish(false))
    socket.once("close", () => finish(false))
  })
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535
}
