import * as net from 'net'

const PORT_RANGE_START = 18080
const PORT_RANGE_END = 18099

function checkHost(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, host)
  })
}

async function isPortFree(port: number): Promise<boolean> {
  const [v4, v6] = await Promise.all([
    checkHost(port, '0.0.0.0'),
    checkHost(port, '::'),
  ])
  return v4 && v6
}

export async function findFreePort(): Promise<number> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (await isPortFree(port)) {
      return port
    }
  }
  throw new Error(`No free port found in range ${PORT_RANGE_START}–${PORT_RANGE_END}`)
}
