'use strict'

const { docopt } = require('docopt')
const { version } = require('../package.json')

class Cli {
  constructor () {
    const doc =
      `
Debug v${version}
Usage:
    debug.js --torrent-hash=TORRENT_HASH [options]
    debug.js --torrent-hashes-stdin [options]
    debug.js -h | --help | --version
Options:
    --redis-host=REDIS_HOST             Connect to redis on REDIS_HOST
    --redis-port=REDIS_PORT             Connect to redis on REDIS_PORT
`
    const _args = docopt(doc, {
      version: version
    })
    this.args = () => {
      return _args
    }
  }
}

const cli = new Cli()
const args = cli.args()

if (args['--redis-host']) {
  process.env.REDIS_HOST = args['--redis-host']
}

if (args['--redis-port']) {
  process.env.REDIS_PORT = args['--redis-port']
}

if (args['--torrent-hash']) {
  process.env.TORRENT_HASH = args['--torrent-hash']
}

const { redisClient, lock } = require('./redis.js')
const functions = (require('./functions.js')(redisClient, lock, true))

async function debugScrape (hash) {
  let unlock
  try {
    const rawTorrents = await redisClient.hgetallAsync('torrents')
    const torrentHashes = Object.keys(rawTorrents)

    if (!(torrentHashes.includes(hash))) {
      console.error(`Hash ${hash} is not valid`)
    } else {
      const torrent = JSON.parse(rawTorrents[hash])

      const trackerIgnore = await redisClient.smembersAsync('tracker_ignore')
      console.debug('Waiting for queue lock')
      unlock = await lock('qLock')
      console.debug('Fetching queue contents')
      const queued = await redisClient.smembersAsync('queue')
      if (hash in queued) {
        console.error(`Hash ${hash} is already queued`)
      } else {
        const isStale = functions.isStale(torrent, trackerIgnore)
        const isStaleDHT = functions.isStaleDHT(torrent)
        const dhtScraped = torrent?.dhtData?.scraped_date
        const trackers = torrent.trackers.map(tracker => {
          return {
            tracker,
            stale: functions.isStaleTracker(torrent, tracker, trackerIgnore),
            lastScraped: torrent?.trackerData && tracker in torrent.trackerData ? torrent.trackerData[tracker].scraped_date : 'never',
            isBlacklisted: trackerIgnore.includes(tracker)
          }
        })
        console.info({
          hash,
          isStale,
          isStaleDHT,
          dhtScraped,
          trackers
        })
        if (isStale) {
          await redisClient.hsetAsync('torrents', hash, JSON.stringify(await functions.scrape(torrent, trackerIgnore)))
          await redisClient.sremAsync('queue', hash)
        }
      }
    }
  } catch (err) {
    console.error(err)
  } finally {
    if (typeof unlock === 'function') unlock()
  }
}

if (process.env.TORRENT_HASH !== '') {
  (async () => {
    console.info(`Debugging hash ${process.env.TORRENT_HASH}`)
    await debugScrape(process.env.TORRENT_HASH)
    console.info('Finished')
    await redisClient.quitAsync()
    process.exit()
  })()
} else if (args['--torrent-hashes-stdin']) {
  (async () => {
    const fs = require('fs')
    const hashesRaw = fs.readFileSync(0, 'utf-8')
    console.log(hashesRaw, 'hashesRaw')
    const hashes = hashesRaw.split(' ')
    for (const h of hashes) {
      console.info(`Debugging hash ${h}`)
      await debugScrape(h)
      console.info('Finished')
    }
    await redisClient.quitAsync()
    process.exit()
  })()
} else {
  module.exports = debugScrape
}
