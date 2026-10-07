/**
 * dsh-quick-session — Host half.
 *
 * The browser half cannot prepare the scratch directory itself: this profile
 * composes the *native* directory-picker backend, whose capability serves only
 * `pick` — the `list`/`createDirectory` verbs belong to the browse backend and
 * are refused on this host (directory-picker/unavailable). So the host owns the
 * filesystem work and answers one authenticated same-origin POST.
 *
 * This file is the package entry rather than `lib/index.js` on purpose: Node
 * caches ESM modules by resolved URL, the host half has no hot reload outside
 * the profile's watched module roots, and a fresh entry file name is what makes
 * a bundle reload actually import the new code.
 *
 * @module dsh-quick-session
 */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Cordis plugin name. */
export const name = 'quick-session'

/**
 * The route needs the browser carrier. The connection fence is read through the
 * optional accessor (`ctx.get`) rather than a bare property read: an undeclared
 * service property throws in Cordis, which the HTTP carrier surfaces as a bare
 * 400 on every request.
 */
export const inject = ['webServer']

/** The one route this plugin owns. */
const ROUTE_PATH = '/plugins/dsh-quick-session/prepare'
/** The scratch tree, relative to the DSH home. */
const SCRATCH_DIR_NAME = 'scratch'
/** Attempts to mint a directory name that is still free. */
const CREATE_ATTEMPTS = 4

/** The DSH home this installation keeps its state in. */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/** A short, sortable directory name for one quick Session. */
function scratchName() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const suffix = Math.random().toString(16).slice(2, 8).padEnd(6, '0')
  return `quick-${stamp}-${suffix}`
}

/**
 * The composed connection service, or undefined on a deployment without one.
 * @param ctx - the Host context.
 * @returns the fence owner when this host has one.
 */
function connectionOf(ctx) {
  try {
    const connection = ctx.get('connection')
    return connection === null ? undefined : connection
  } catch {
    return undefined
  }
}

/** JSON response; every answer here is a live fact, so it is never cached. */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Reject a request the deployment's Host/Origin fence or browser authentication
 * refuses. Returns true when the request was answered.
 * @param connection - the composed connection service, when this host has one.
 * @param req - the incoming request.
 * @param res - the response to answer on.
 * @returns whether the request was rejected.
 */
function rejected(connection, req, res) {
  if (connection === undefined || typeof connection.requestRejection !== 'function') return false
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/**
 * Create one fresh directory for a quick Session and answer its absolute path.
 * @param root - the scratch root, created when missing.
 * @returns the absolute path of the new per-Session directory.
 */
async function createScratchDirectory(root) {
  await mkdir(root, { recursive: true })
  let lastError
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const target = join(root, scratchName())
    try {
      await mkdir(target)
      return target
    } catch (error) {
      lastError = error
      if (error?.code !== 'EEXIST') throw error
    }
  }
  throw lastError ?? new Error('could not allocate a scratch directory')
}

/** Mount the prepare route. @param ctx - the Host context. */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      if (rejected(connectionOf(ctx), req, res)) return
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      try {
        const cwd = await createScratchDirectory(join(dshHome(), SCRATCH_DIR_NAME))
        sendJson(res, 200, { cwd })
      } catch (error) {
        sendJson(res, 500, {
          code: 'prepare-failed',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }), `dsh-quick-session: POST ${ROUTE_PATH}`)
}
