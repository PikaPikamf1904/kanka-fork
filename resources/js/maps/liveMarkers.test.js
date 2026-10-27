import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLiveMarkers, markerUrl } from './liveMarkers.js'

function notFound() {
    const error = new Error('Not Found')
    error.response = { status: 404 }

    return error
}

function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })

    return { promise, resolve, reject }
}

function harness({ pins = [], fetchPin, fetchPins } = {}) {
    const state = { pins, removed: [], updated: [], fetched: [] }
    const live = createLiveMarkers({
        getMapId: () => 7,
        fetchPin: async (id) => {
            state.fetched.push(id)

            return fetchPin(id)
        },
        fetchPins: async () => fetchPins(),
        getPins: () => state.pins,
        setPins: (next) => {
            state.pins = next
        },
        onRemoved: (id) => state.removed.push(id),
        onUpdated: (pin) => state.updated.push(pin.id),
    })

    return { state, live }
}

test('a change fetches the marker by id and adds it', async () => {
    const { state, live } = harness({ fetchPin: async (id) => ({ id, name: 'Harbor Master' }) })

    await live.changed({ action: 'created', id: 3, map_id: 7 })

    assert.deepEqual(state.fetched, [3])
    assert.deepEqual(state.pins, [{ id: 3, name: 'Harbor Master' }])
})

test('an update replaces the cached marker', async () => {
    const { state, live } = harness({
        pins: [{ id: 3, name: 'old' }, { id: 4, name: 'other' }],
        fetchPin: async (id) => ({ id, name: 'new' }),
    })

    await live.changed({ action: 'updated', id: 3, map_id: 7 })

    assert.deepEqual(state.pins, [{ id: 3, name: 'new' }, { id: 4, name: 'other' }])
})

test('a 404 from the API evicts the cached marker (permission or visibility lost)', async () => {
    const { state, live } = harness({
        pins: [{ id: 3, name: 'secret' }, { id: 4 }],
        fetchPin: async () => {
            throw notFound()
        },
    })

    await live.changed({ action: 'updated', id: 3, map_id: 7 })

    assert.deepEqual(state.pins, [{ id: 4 }])
    assert.deepEqual(state.removed, [3])
})

test('a deletion removes the marker without asking the API', async () => {
    const { state, live } = harness({ pins: [{ id: 3 }], fetchPin: async () => assert.fail('no fetch') })

    await live.changed({ action: 'deleted', id: 3, map_id: 7 })

    assert.deepEqual(state.pins, [])
    assert.deepEqual(state.removed, [3])
})

test('updates for another map are ignored', async () => {
    const { state, live } = harness({ pins: [{ id: 3 }], fetchPin: async () => assert.fail('no fetch') })

    await live.changed({ action: 'deleted', id: 3, map_id: 8 })

    assert.deepEqual(state.pins, [{ id: 3 }])
})

test('a network error leaves the map untouched', async () => {
    const { state, live } = harness({
        pins: [{ id: 3, name: 'kept' }],
        fetchPin: async () => {
            throw new Error('offline')
        },
    })

    await live.changed({ action: 'updated', id: 3, map_id: 7 })

    assert.deepEqual(state.pins, [{ id: 3, name: 'kept' }])
})

test('an older response that lands after a newer one is ignored', async () => {
    const first = deferred()
    const second = deferred()
    const responses = [first, second]
    const { state, live } = harness({ fetchPin: () => responses.shift().promise })

    const a = live.changed({ action: 'updated', id: 3, map_id: 7 })
    const b = live.changed({ action: 'updated', id: 3, map_id: 7 })
    second.resolve({ id: 3, name: 'newer' })
    await b
    first.resolve({ id: 3, name: 'older' })
    await a

    assert.deepEqual(state.pins, [{ id: 3, name: 'newer' }])
})

test('a fetch overtaken by a deletion does not bring the marker back', async () => {
    const pending = deferred()
    const { state, live } = harness({ pins: [{ id: 3 }], fetchPin: () => pending.promise })

    const a = live.changed({ action: 'updated', id: 3, map_id: 7 })
    await live.changed({ action: 'deleted', id: 3, map_id: 7 })
    pending.resolve({ id: 3, name: 'stale' })
    await a

    assert.deepEqual(state.pins, [])
})

test('a resync replaces every pin and drops the ones no longer visible', async () => {
    const { state, live } = harness({
        pins: [{ id: 1 }, { id: 2, name: 'revoked' }],
        fetchPins: async () => [{ id: 1, name: 'fresh' }],
    })

    await live.resync()

    assert.deepEqual(state.pins, [{ id: 1, name: 'fresh' }])
    assert.deepEqual(state.removed, [2])
})

test('a resync that finds the map out of reach clears it', async () => {
    const { state, live } = harness({
        pins: [{ id: 1 }, { id: 2 }],
        fetchPins: async () => {
            const error = new Error('Forbidden')
            error.response = { status: 403 }
            throw error
        },
    })

    await live.resync()

    assert.deepEqual(state.pins, [])
    assert.deepEqual(state.removed, [1, 2])
})

test('updates that arrive during a resync run after it', async () => {
    const pending = deferred()
    const { state, live } = harness({
        pins: [],
        fetchPins: () => pending.promise,
        fetchPin: async (id) => ({ id, name: 'live' }),
    })

    const resync = live.resync()
    await live.changed({ action: 'created', id: 9, map_id: 7 })
    assert.deepEqual(state.fetched, [])
    pending.resolve([{ id: 1 }])
    await resync
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(state.pins, [{ id: 1 }, { id: 9, name: 'live' }])
})

test('the marker URL sits under the map API, without its query string', () => {
    assert.equal(
        markerUrl('https://chronicle.test/w/1/entities/5/map-api?focus=3', 12),
        'https://chronicle.test/w/1/entities/5/map-api/markers/12',
    )
    assert.equal(
        markerUrl('/w/1/entities/5/map-api', 12, 'http://127.0.0.1:8088/w/1/entities/5/map'),
        'http://127.0.0.1:8088/w/1/entities/5/map-api/markers/12',
    )
})
