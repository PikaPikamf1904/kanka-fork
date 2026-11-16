import { upsertPin } from './pinCollection.js'

// Live marker updates carry nothing but { action, id, map_id }. The marker itself comes from the
// permission-checked map API, which answers 404 for a marker the user can't see (any more), so a
// 404 removes it from the map. Resyncs (after a permission change, or a reconnect that may have
// missed updates) reload every pin.
export function createLiveMarkers({ getMapId, fetchPin, fetchPins, getPins, setPins, onRemoved, onUpdated }) {
    // Each marker's newest request, so an older response that lands later is ignored.
    const latest = new Map()
    let sequence = 0
    let resyncSequence = 0
    // Updates that arrive while a resync is loading wait for it, then run on top of it.
    let queued = null

    function remove(ids) {
        const gone = new Set(ids)
        if (gone.size === 0) {
            return
        }
        setPins(getPins().filter((pin) => !gone.has(pin.id)))
        gone.forEach((id) => onRemoved?.(id))
    }

    async function changed(payload) {
        const { action, id, map_id: mapId } = payload || {}
        if (id === undefined || id === null || Number(mapId) !== Number(getMapId())) {
            return
        }
        if (queued) {
            queued.push(payload)

            return
        }

        const mine = ++sequence
        latest.set(id, mine)

        if (action === 'deleted') {
            latest.delete(id)
            remove([id])

            return
        }

        let pin = null
        try {
            pin = await fetchPin(id)
        } catch (e) {
            if (e?.response?.status !== 404) {
                // Leave the map as it is; the next resync or reconnect puts it right.
                if (latest.get(id) === mine) {
                    latest.delete(id)
                }

                return
            }
        }

        if (latest.get(id) !== mine || mine < resyncSequence) {
            return
        }
        latest.delete(id)

        if (pin) {
            setPins(upsertPin(getPins(), pin))
            onUpdated?.(pin)
        } else {
            remove([id])
        }
    }

    async function resync() {
        const mine = ++sequence
        resyncSequence = mine
        latest.clear()
        queued = queued || []

        let pins = null
        try {
            pins = await fetchPins()
        } catch (e) {
            const status = e?.response?.status
            // The map itself is out of reach now: nothing on it may stay on screen.
            if (status === 403 || status === 404) {
                pins = []
            }
        }

        if (resyncSequence !== mine) {
            return
        }
        const waiting = queued
        queued = null

        if (pins) {
            const kept = new Set(pins.map((pin) => pin.id))
            const removed = getPins().filter((pin) => !kept.has(pin.id)).map((pin) => pin.id)
            setPins(pins)
            removed.forEach((id) => onRemoved?.(id))
            pins.forEach((pin) => onUpdated?.(pin))
        }

        for (const payload of waiting) {
            changed(payload)
        }
    }

    return { changed, resync }
}

// The single-marker endpoint sits under the map API: …/map-api/markers/{id}.
export function markerUrl(api, id, base) {
    const url = new URL(api, base)
    url.pathname = url.pathname.replace(/\/+$/, '') + '/markers/' + encodeURIComponent(id)
    url.search = ''

    return url.toString()
}
