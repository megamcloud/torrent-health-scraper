'use strict'

const { docopt } = require('docopt')
const { version } = require('../package.json')

class Cli {
  constructor () {
    const doc =
      `
Add v${version}
Usage:
    add.js [--torrent-url=TORRENT_URL] [--type=TYPE] [options]
    add.js -h | --help | --version
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

if (args['--torrent-url']) {
  process.env.TORRENT_URL = args['--torrent-url']
}

if (args['--type']) {
  process.env.TORRENT_TYPE = args['--type']
}

const { torrentFromUrl } = require('./utils.js')

async function run () {
  if (process.env.TORRENT_URL) {
    const fetchedTorrent = await torrentFromUrl(process.env.TORRENT_URL)
    if (fetchedTorrent) {
      await add(process.env.TORRENT_URL, fetchedTorrent)
    }
  }
  process.exit()
}

async function add (link, torrent) {
  const { redisClient } = require('./redis.js')
  const { infoHash, name, created, length, files, announce } = torrent
  const existing = await redisClient.hgetAsync('torrents', infoHash)
  const exists = existing !== null
  const created_unix = Math.floor(Date.parse(created) / 1000)
  console.log({ infoHash, name, exists, created_unix, length, files: files.length, trackers: announce.length })
  if (!exists) {
    const newTorrent = { _id: infoHash, name, link, created_unix, size_bytes: length, trackers: announce }
    if (process.env.TORRENT_TYPE) {
      newTorrent.type = process.env.TORRENT_TYPE
    }
    await redisClient.hsetAsync('torrents', newTorrent._id, JSON.stringify(newTorrent))
    console.log('Added to db')
  }
}

run()
