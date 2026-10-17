<template>
    <!-- Search and the selected entity (top-left floating, clear of the zoom controls) -->
    <div v-if="ready" class="fixed top-3 left-3 right-24 sm:right-auto sm:w-80 z-700 flex flex-col gap-2">
        <div class="relative">
            <label for="web-search" class="sr-only" v-html="trans('search')"></label>
            <input
                id="web-search"
                ref="searchInput"
                v-model="search"
                type="search"
                autocomplete="off"
                :placeholder="trans('search')"
                class="w-full min-h-11 px-3 rounded-xl bg-base-100/90 backdrop-blur shadow-lg border border-base-300 text-base-content"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="web-search-results"
                :aria-expanded="search.trim().length > 0"
                @keydown.enter.prevent="chooseResult(searchResults[0])"
                @keydown.escape.prevent="search = ''"
            />
            <ul
                v-if="search.trim().length > 0"
                id="web-search-results"
                class="absolute top-full mt-1 left-0 right-0 flex flex-col bg-base-100 shadow-lg rounded-xl p-1 max-h-72 overflow-y-auto"
                role="listbox"
            >
                <li v-for="result in searchResults" :key="result.id" role="option">
                    <button
                        type="button"
                        class="w-full flex items-center gap-2 px-3 min-h-11 rounded-lg text-left hover:bg-base-200 focus:bg-base-200"
                        @click.prevent="chooseResult(result)"
                    >
                        <span class="truncate">{{ result.name }}</span>
                        <span class="ml-auto shrink-0 text-xs text-base-content/70">{{ result.type }}</span>
                    </button>
                </li>
                <li v-if="searchResults.length === 0" class="px-3 py-2 text-sm text-base-content/70" v-html="trans('search-empty')"></li>
            </ul>
        </div>

        <div v-if="selected" class="flex flex-col gap-2 bg-base-100/90 backdrop-blur shadow-lg rounded-xl p-3" aria-live="polite">
            <div class="flex items-start gap-2">
                <div class="grow min-w-0">
                    <div class="font-semibold truncate">{{ selected.name }}</div>
                    <div class="text-xs text-base-content/70">{{ selected.type }}</div>
                </div>
                <button type="button" class="btn2 btn-ghost btn-sm" :title="trans('clear')" @click.prevent="clearSelection()">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    <span class="sr-only" v-html="trans('clear')"></span>
                </button>
            </div>
            <div class="flex flex-wrap gap-2">
                <a :href="selected.link" class="btn2 btn-primary btn-sm">
                    <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                    <span v-html="trans('open')"></span>
                </a>
                <button type="button" class="btn2 btn-sm" :aria-pressed="focusMode" @click.prevent="toggleFocus()">
                    <i class="fa-solid" :class="focusMode ? 'fa-expand' : 'fa-bullseye'" aria-hidden="true"></i>
                    <span v-html="focusMode ? trans('show-all') : trans('focus')"></span>
                </button>
            </div>
        </div>
    </div>

    <!-- Bottom toolbar -->
    <div v-if="ready" class="fixed bottom-4 left-1/2 -translate-x-1/2 z-700 flex items-center gap-1.5 bg-base-100/80 backdrop-blur rounded-xl shadow-lg px-2 py-1.5">
        <a v-if="ready" :href="urls.back" :title="trans('back')" class="btn2 btn-ghost" tabindex="0">
            <i class="fa-solid fa-house" aria-hidden="true"></i>
        </a>

        <!-- Zone 1: Plus FAB -->
        <div v-if="props.creator" class="relative">
            <button @click.prevent="fabDropdown = !fabDropdown" class="btn2 btn-primary" :title="trans('create')">
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
            </button>
            <div
                v-if="fabDropdown"
                v-click-outside="() => fabDropdown = false"
                class="absolute bottom-full mb-2 left-0 flex flex-col gap-1 bg-base-100 shadow-lg p-2 rounded-lg z-10 min-w-max"
                role="menu"
            >
                <a href="#" @click.prevent="fabDropdown = false; openQQ()" class="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-base-200 cursor-pointer whitespace-nowrap">
                    <i class="fa-solid fa-bolt w-5" aria-hidden="true"></i>
                    <span v-html="trans('create')"></span>
                </a>
                <a href="#" @click.prevent="fabDropdown = false; openCreate()" class="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-base-200 cursor-pointer whitespace-nowrap">
                    <i class="fa-solid fa-link w-5" aria-hidden="true"></i>
                    <span v-html="trans('add')"></span>
                </a>
            </div>
        </div>

        <!-- Zone 2: View controls -->
        <button @click.prevent="zoomToFit()" class="btn2 btn-ghost rounded-lg" :title="trans('zoom-fit')">
            <i class="fa-solid fa-maximize" aria-hidden="true"></i>
        </button>
        <button @click.prevent="resetLayout()" class="btn2 btn-ghost" :title="trans('reset-layout')">
            <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
        </button>
        <div v-if="types.length > 1" class="relative">
            <button
                @click.prevent="typeDropdown = !typeDropdown"
                class="btn2 btn-ghost"
                :class="{ 'text-primary': hiddenTypes.length > 0 }"
                :title="trans('filter')"
                :aria-expanded="typeDropdown"
            >
                <i class="fa-solid fa-filter" aria-hidden="true"></i>
            </button>
            <div
                v-if="typeDropdown"
                v-click-outside="() => typeDropdown = false"
                class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex flex-col gap-1 bg-base-100 shadow-lg p-2 rounded-2xl z-10 min-w-max max-h-[60vh] overflow-y-auto"
            >
                <label
                    v-for="type in types"
                    :key="type.id"
                    class="flex items-center gap-2 px-3 min-h-11 rounded-xl hover:bg-base-200 cursor-pointer whitespace-nowrap"
                >
                    <input type="checkbox" :checked="!hiddenTypes.includes(type.id)" @change="toggleType(type.id)" />
                    <span>{{ type.name }}</span>
                    <span class="ml-auto pl-3 text-xs text-base-content/70">{{ type.count }}</span>
                </label>
                <button
                    v-if="hiddenTypes.length > 0"
                    type="button"
                    class="flex items-center gap-2 px-3 min-h-11 rounded-xl hover:bg-base-200 whitespace-nowrap"
                    @click.prevent="showAllTypes()"
                >
                    <i class="fa-solid fa-eye w-5" aria-hidden="true"></i>
                    <span v-html="trans('show-all')"></span>
                </button>
            </div>
        </div>

        <div class="w-px h-6 bg-base-content/20"></div>

        <!-- Zone 3: Export -->
        <div class="relative">
            <button @click.prevent="downloadDropdown = !downloadDropdown" class="btn2 btn-ghost" :title="trans('download')">
                <i class="fa-solid fa-download" aria-hidden="true"></i>
            </button>
            <div
                v-if="downloadDropdown"
                v-click-outside="() => downloadDropdown = false"
                class="absolute bottom-full mb-2 right-0 flex flex-col gap-1 bg-base-100 shadow-lg p-2 rounded-2xl z-10 min-w-max"
                role="menu"
            >
                <a @click.prevent="downloadPng()" class="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-base-200 cursor-pointer whitespace-nowrap">
                    <i class="fa-solid fa-image w-5" aria-hidden="true"></i>
                    <span v-html="trans('download-png')"></span>
                </a>
                <a @click.prevent="downloadPdf()" class="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-base-200 cursor-pointer whitespace-nowrap">
                    <i class="fa-solid fa-file-pdf w-5" aria-hidden="true"></i>
                    <span v-html="trans('download-pdf')"></span>
                </a>
            </div>
        </div>
    </div>

    <div v-if="!ready" class="w-full h-screen flex items-center justify-center text-4xl gap-2 absolute bg-base-100 transition-all duration-300 top-0 bottom-0 left-0 right-0 z-900">
        <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
        <span v-if="loading">Loading</span>
        <span v-else-if="parsing">Parsing web</span>
        <span v-else-if="drawing">Drawing web</span>
    </div>
    <div ref="cyContainer" class="min-h-screen text-base-content cy-map bg-base-100">
    </div>

</template>
<style>
@import 'cytoscape-panzoom/cytoscape.js-panzoom.css';
.cy-panzoom {
    z-index: 800;
    left: unset;
    right: 3.7rem;
    top: 0.7rem;
}
/* Finger-sized toolbar buttons on touch screens */
@media (pointer: coarse) {
    .connections-web-page .btn2 {
        min-height: 2.75rem;
        min-width: 2.75rem;
    }
}
</style>

<script setup lang="ts">

import { ref, shallowRef, computed, onMounted, onBeforeUnmount} from 'vue';
import tippy, { Instance, ReferenceElement } from 'tippy.js'
import { cssVariable } from '../../utility/colours';


const props = defineProps<{
    api: String,
    premium: Boolean,
    creator: Boolean,
}>()

const ready = ref(false)
const loading = ref(false)
const parsing = ref(false)
const drawing = ref(false)
// Cytoscape objects stay out of Vue's deep reactivity. Proxied copies of a node don't
// compare equal to the node itself, which breaks neighbourhood lookups.
const elements = shallowRef([])
const cy = shallowRef(null)
const currentEntity = shallowRef(null)
const relation = shallowRef(null)
const cyContainer = ref()
const entityTooltips = ref(Array)
let nodeTippy: Instance | null = null
const downloadDropdown = ref(false)
const fabDropdown = ref(false)
const i18n = ref(null)
const urls = ref(null)

// Search, type filter and focus only change what is drawn. The server already left out
// everything this user isn't allowed to see.
type IndexedNode = { id: string, name: string, type_id: number, type: string, link: string }
const nodeIndex = ref<IndexedNode[]>([])
const search = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const selected = ref<IndexedNode | null>(null)
const focusMode = ref(false)
const hiddenTypes = ref<number[]>([])
const typeDropdown = ref(false)
let listenersBound = false

const fold = (value: string) => String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const searchResults = computed(() => {
    const needle = fold(search.value.trim())
    if (!needle) return []
    return nodeIndex.value
        .filter((node) => fold(node.name).includes(needle))
        .sort((a, b) => Number(!fold(a.name).startsWith(needle)) - Number(!fold(b.name).startsWith(needle))
            || a.name.localeCompare(b.name))
        .slice(0, 8)
})

const types = computed(() => {
    const byType = new Map<number, { id: number, name: string, count: number }>()
    nodeIndex.value.forEach((node) => {
        const type = byType.get(node.type_id) ?? { id: node.type_id, name: node.type, count: 0 }
        type.count++
        byType.set(node.type_id, type)
    })
    return [...byType.values()].sort((a, b) => a.name.localeCompare(b.name))
})

onMounted(async () => {
    await initCytoscape()
    await loadData()
    await addToCy()
    ready.value = true

    // Attach listener for *capturing* submit events
    document.addEventListener('submit', handleDialogFormSubmit, true)
    document.addEventListener('keydown', handleKeydown)

    window.initTooltips();

    if (!props.premium) {
        window.openDialog('web-premium')
    }
})

onBeforeUnmount(() => {
    if (cy.value) {
        cy.value.destroy();
        cy.value = null;
    }

    document.removeEventListener('submit', handleDialogFormSubmit, true)
    document.removeEventListener('keydown', handleKeydown)
})

const parseData = (data) => {
    parsing.value = true

    Object.values(data.entities).forEach((entity: any) => {
        addEntity(entity)
    });
    data.nodes.forEach((node: any) => {
        addNode(node)
    })
    i18n.value = data.i18n
    urls.value = data.urls

    parsing.value = false
}

const addEntity = (entity) => {
    // Already loaded entity
    if (elements.value.find(e => e.data.id == entity.id)) {
        return;
    }

    const element = {
        group: 'nodes',
        data: {
            id: entity.id,
            name: entity.name,
            image: entity.image,
            link: entity.link,
            tooltip: entity.tooltip,
            type_id: entity.type_id,
            type: entity.type,
        }
    };
    elements.value.push(element);

    if (ready.value && cy.value) {
        cy.value.add(element);
    }
}

// Entities and relations are numbered separately, but Cytoscape needs every node and edge
// id to be unique. Without a prefix, relation 1 clashes with entity 1 and isn't drawn.
const relationEdgeId = (id: number | string) => `relation-${id}`

const addNode = (node) => {
    let element = {
        group: 'edges',
        data: {
            id: relationEdgeId(node.id),
            source: node.source,
            target: node.target,
            name: node.text,
            colour: node.colour,
            attitude: node.attitude,
            shape: node.shape,
            url: node.url,
        }
    };
    // if the relation does not have a colour, use the default
    if (!element.data.colour) {
        element.data.colour = '#777777';
    }
    if (!element.data.attitude) {
        element.data.attitude = 0;
    }
    element.data.attitude = getWidthFromAttitude(element.data.attitude);
    elements.value.push(element);
}


const getWidthFromAttitude = (attitude: any) => {
    return (((attitude + 100) / 100) * 2) + 2;
}

const initCytoscape = async () => {

    const { default: cytoscape } = await import('cytoscape')
    const { default: coseBilkent } = await import('cytoscape-cose-bilkent')
    const { default: panzoom } = await import('cytoscape-panzoom')


    // Libraries
    cytoscape.use( coseBilkent )
    cytoscape.use( panzoom )

    const container = cyContainer.value
    const parent = container.parentNode as HTMLElement
    const containerStyles = window.getComputedStyle(container)
    const parentStyles = window.getComputedStyle(parent)
    const accent = resolveColour('hsl(var(--p))', parentStyles.color)

    cy.value = cytoscape({
        container: cyContainer.value,
        style: cytoscape.stylesheet()
            .selector('node')
            .css({
                'label': 'data(name)',
                'background-image': 'data(image)',
                'height': 80,
                'width': 80,
                'background-fit': 'cover',
                'border-color': parentStyles.color,
                'border-width': 3,
                'color': containerStyles.color,
                'text-wrap': 'wrap',
                'text-margin-y': '-8px',
                'text-background-opacity': 1,
                'text-background-color': containerStyles.backgroundColor,
                'text-border-color': containerStyles.backgroundColor,
                'text-border-width': 3,
                'text-border-opacity': 1
            })
            .selector('edge')
            .css({
                'line-color': 'data(colour)',
                'curve-style': 'bezier',
                'control-point-step-size': 40,
                'target-arrow-shape': 'data(shape)',
                'target-arrow-color': 'data(colour)',
                'width': 'data(attitude)',
                'text-background-opacity': 1,
                'color': containerStyles.color,
                'text-background-color': containerStyles.backgroundColor,
                'text-border-color': containerStyles.backgroundColor,
                'text-border-width': 3,
                'text-border-opacity': 1
            })
            // Hovering shows a relation's label. A finger can't hover, so selecting an
            // entity labels its relations too.
            .selector('edge.hovered, edge.labelled')
            .css({
                'label': 'data(name)',
            })
            .selector('edge.hovered')
            .css({
                'overlay-opacity': 0.1,
            })
            .selector('node.selected-node')
            .css({
                'border-color': accent,
                'border-width': 6,
            })
            .selector('.faded')
            .css({
                'opacity': 0.15,
            }),
    });

    // enable pan/zoom buttons
    const minZoom = 0.1
    const maxZoom = 1.2
    cy.value.panzoom({
        maxZoom: maxZoom,
        minZoom: minZoom,
    });
    cy.value.minZoom(minZoom);
    cy.value.maxZoom(maxZoom);
}

const loadData = async () => {
    loading.value = true
    const res = await axios.get(props.api)
    loading.value = false;

    const data = res.data;
    parseData(data);

}
const addToCy = async () => {
    if (!cy.value) return

    drawing.value = true;
    drawing.value = true;

    // add all of the elements (nodes and edges) to the graph. Hide orphans to keep the graph clean.
    cy.value.add(elements.value);
    refreshView();

    // organize and display the elements
    runLayout();

    // add user input events to the elements
    addListeners();

    // wait until images load to display graph
    await finishDrawing();
}

const runLayout = () => {
    // use an automatic layout. fcose is decently fast and looks nice
    const layout = cy.value.elements().layout({
        name: 'cose-bilkent',
        idealEdgeLength: 130,
        nodeDimensionsIncludeLabels: true,
    });
    layout.run();
}

const addListeners = () => {
    // Delegated listeners also cover entities and relations added later, so bind them once.
    if (listenersBound) return
    listenersBound = true

    cy.value.on('tap', 'node', function (evt) {
        const node = evt.target
        selectNode(node)
        showNodeTooltip(node)
    });

    // Double-click or double-tap an entity to open its page
    cy.value.on('dbltap', 'node', function (evt) {
        const link = evt.target.data('link');
        if (link) {
            window.location.assign(link);
        }
    });

    // Tap the background to clear the selection
    cy.value.on('tap', function (evt) {
        if (evt.target === evt.cy) {
            clearSelection();
        }
    });

    cy.value.on('mouseover', 'node', function(e) {
        currentEntity.value = e.target;
        currentEntity.value.addClass('node-hover');
    });

    cy.value.on('mouseout', 'node', function() {
        if (!currentEntity.value) return;
        currentEntity.value.removeClass('node-hover');
        currentEntity.value = null;
    });

    // Tap a relation to edit it
    cy.value.on('tap', 'edge', function (e) {
        let editUrl = e.target.data().url;
        if (!editUrl) {
            return;
        }

        window.openDialog('primary-dialog', editUrl);
    });

    cy.value.on('mouseover', 'edge', function(e) {
        relation.value = e.target;
        relation.value.addClass('hovered');
    });

    cy.value.on('mouseout', 'edge', function() {
        if (!relation.value) return;
        relation.value.removeClass('hovered');
        relation.value = null;
    });
}

const selectNode = (node: any) => {
    selected.value = {
        id: String(node.id()),
        name: node.data('name'),
        type_id: node.data('type_id'),
        type: node.data('type'),
        link: node.data('link'),
    }
    applyVisibility()
}

const clearSelection = () => {
    selected.value = null
    focusMode.value = false
    applyVisibility()
}

const toggleFocus = () => {
    if (!selected.value || !cy.value) return
    focusMode.value = !focusMode.value
    applyVisibility()

    const node = cy.value.getElementById(selected.value.id)
    if (focusMode.value && node.length > 0) {
        cy.value.animate({ fit: { eles: node.closedNeighborhood(':visible'), padding: 60 } }, { duration: 300 })
    }
}

const toggleType = (id: number) => {
    hiddenTypes.value = hiddenTypes.value.includes(id)
        ? hiddenTypes.value.filter((hidden) => hidden !== id)
        : [...hiddenTypes.value, id]
    applyVisibility()
}

const showAllTypes = () => {
    hiddenTypes.value = []
    applyVisibility()
}

const chooseResult = (result?: IndexedNode) => {
    if (!result || !cy.value) return
    const node = cy.value.getElementById(result.id)
    if (node.length === 0) return

    // Finding an entity whose type is filtered out shows that type again
    hiddenTypes.value = hiddenTypes.value.filter((hidden) => hidden !== result.type_id)
    search.value = ''
    searchInput.value?.blur()
    selectNode(node)
    cy.value.animate({ center: { eles: node }, zoom: Math.max(cy.value.zoom(), 0.8) }, { duration: 300 })
}

// Rebuild what search and the type filter know about, after the web changed
const refreshView = () => {
    if (!cy.value) return
    const instance = cy.value
    nodeIndex.value = instance.nodes()
        .filter((node) => node.connectedEdges().length > 0)
        .map((node) => ({
            id: String(node.id()),
            name: node.data('name'),
            type_id: node.data('type_id'),
            type: node.data('type'),
            link: node.data('link'),
        }))
    hiddenTypes.value = hiddenTypes.value.filter((id) => nodeIndex.value.some((node) => node.type_id === id))
    applyVisibility()
}

// Hide orphans, filtered types and, in focus mode, everything not next to the selection.
// Then fade what isn't connected to the selected entity and label its relations.
const applyVisibility = () => {
    if (!cy.value) return
    const instance = cy.value

    let node = selected.value ? instance.getElementById(selected.value.id) : null
    const gone = node && (node.length === 0 || node.connectedEdges().length === 0)
    if (gone || (node && hiddenTypes.value.includes(node.data('type_id')))) {
        selected.value = null
        focusMode.value = false
        node = null
    }
    const focus = focusMode.value && node ? node.closedNeighborhood() : null

    instance.batch(() => {
        instance.nodes().forEach((each) => {
            const shown = each.connectedEdges().length > 0
                && !hiddenTypes.value.includes(each.data('type_id'))
                && (!focus || focus.has(each))
            if (shown) {
                each.show()
            } else {
                each.hide()
            }
        })

        instance.elements().removeClass('faded selected-node labelled')
        if (node) {
            instance.elements().not(node.closedNeighborhood()).addClass('faded')
            node.addClass('selected-node')
            node.connectedEdges().addClass('labelled')
        }
    })
}

const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !selected.value) return
    const target = event.target as HTMLElement | null
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    // An open dialog gets the escape key
    if (document.querySelector('dialog[open]')) return
    clearSelection()
}

// Cytoscape only understands plain colours, so let the browser resolve theme variables
const resolveColour = (value: string, fallback: string) => {
    const probe = document.createElement('span')
    probe.style.color = value
    if (!probe.style.color) return fallback
    document.body.appendChild(probe)
    const colour = window.getComputedStyle(probe).color
    probe.remove()
    return colour || fallback
}

const finishDrawing = async () => {
    let backgrounding = true;
    while (backgrounding) {
        if (cy.value.nodes(':backgrounding').length == 0) {
            backgrounding = false;
        } else {
            await sleep(200);
        }
    }

    drawing.value = false;
}

const showNodeTooltip = (node: any) => {
    const cyInstance = cy.value;
    if (!cyInstance) return;

    const container = cyInstance.container();
    if (!container) return;

    // Position of the node in rendered pixel coordinates
    const pos = node.renderedPosition();
    const rect = container.getBoundingClientRect();

    // Function returning the virtual rect for this tooltip
    const getReferenceClientRect = () => {
        const x = rect.left + pos.x;
        const y = rect.top + pos.y;

        return {
            x,
            y,
            left: x,
            top: y,
            right: x,
            bottom: y,
            width: 0,
            height: 0,
        } as DOMRect;
    };

    // Kill any previous tooltip
    if (nodeTippy) {
        nodeTippy.destroy();
        nodeTippy = null;
    }

    nodeTippy = tippy(document.body, {
        trigger: 'manual',
        // This is the key bit for virtual positioning in Tippy v6+
        getReferenceClientRect,

        theme: 'entity-tooltip',
        placement: 'bottom',
        hideOnClick: true,
        allowHTML: true,
        interactive: true,
        content: 'Loading...',
        appendTo: () => document.body, // keep it simple & safe
        onShow(instance) {
            const id = String(node.id());
            if (id in entityTooltips.value) {
                instance.setContent(entityTooltips.value[id]);
                return;
            }
            axios.get(node.data().tooltip)
                .then((res) => {
                    const html = res.data;
                    instance.setContent(html);
                    entityTooltips.value[id] = html;
                })
                .catch((error) => {
                        instance.setContent(`Failed loading tooltip. ${error}`);
                    }
                );
        },
    });

    nodeTippy.show();
};

const handleDialogFormSubmit = async (event: SubmitEvent) => {
    const form = event.target as HTMLFormElement | null
    if (!form) return

    event.preventDefault()

    try {
        const method = (form.method || 'POST').toUpperCase()
        const url = form.action
        const formData = new FormData(form)

        const response = await axios({
            url,
            method,
            data: formData,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
            },
        })

        if (response.data.created) {
            handleRelationCreate(response.data)
        } else {
            handleRelationUpdate(response.data)
        }

        if (window.closeDialog) {
            window.closeDialog('primary-dialog')
        }
    } catch (error) {
        if (error.response && error.response.status === 422 && error.response.data?.errors) {
            showDialogErrors(form, error.response.data.errors)
        } else {
            console.error(error)
        }
    }
}

const showDialogErrors = (form: HTMLFormElement, errors: Record<string, string[]>) => {
    const article = form.closest('article')
    if (!article) return

    // Remove any previous error alert
    article.querySelector('.alert.alert-error.js-web-errors')?.remove()

    const messages = Object.values(errors).flat()
    const alert = document.createElement('div')
    alert.className = 'alert alert-error border-0 rounded-lg p-4 flex shadow-xs gap-2 items-center js-web-errors'
    const list = document.createElement('ul')
    messages.forEach((msg) => {
        const li = document.createElement('li')
        li.textContent = msg
        list.appendChild(li)
    })
    alert.appendChild(list)
    article.prepend(alert)
}

const handleRelationUpdate = async (data) => {
    if (!cy.value || !data || !data.id) return


    const edge = cy.value.getElementById(relationEdgeId(data.id))

    if (!edge || edge.length === 0) {
        console.warn('Updated unknown edge', data.id);
        return
    }

    if (data.deleted) {
        edge.remove();
        refreshView();
        return
    }

    // Reuse your existing logic for width
    const width = getWidthFromAttitude(data.attitude ?? 0)

    // Cytoscape edges are immutable (source/target), so if the target changes, we need to re-create the edge
    if (edge.data().target != data.target.id) {
        // Maybe import the new entity
        addEntity(data.target);
        await finishDrawing();

        const newEdge = {
            group: 'edges',
            data: {
                ...edge.data(),
                name: data.text,
                target: data.target.id,
                colour: data.colour || '#777777',
                attitude: width,
            }
        };
        edge.remove();
        cy.value.add(newEdge);
    } else {
        edge.data({
            ...edge.data(),
            name: data.text,
            colour: data.colour || '#777777',
            attitude: width,
        })
    }
    refreshView();
}

const handleRelationCreate = async (data) => {
    if (!cy.value || !data) return

    // Add both source and target entities (they may already exist)
    addEntity(data.target);
    if (data.source) {
        const sourceNode = cy.value.getElementById(data.source);
        if (sourceNode.length === 0) {
            // Source entity not in graph yet, reload to get it
            await reloadData();
            return;
        }
    }
    await finishDrawing();

    const width = getWidthFromAttitude(data.attitude ?? 0)
    const edge = {
        group: 'edges',
        data: {
            id: relationEdgeId(data.id),
            source: data.source,
            target: data.target.id,
            name: data.text,
            colour: data.colour || '#777777',
            attitude: width,
            shape: data.shape || 'triangle',
            url: data.url,
        }
    };
    cy.value.add(edge);

    // Show the target node if it was hidden as an orphan
    refreshView();

    runLayout();
}

const reloadData = async () => {
    elements.value = [];
    await loadData();
    cy.value.elements().remove();
    cy.value.add(elements.value);
    refreshView();
    runLayout();
    addListeners();
    await finishDrawing();
}

const openCreate = () => {
    window.openDialog("primary-dialog", urls.value.create)
}

const openQQ = () => {
    window.openDialog("primary-dialog", urls.value.creator)
}

const zoomToFit = () => {
    if (!cy.value) return
    cy.value.fit(undefined, 30)
}

const resetLayout = () => {
    if (!cy.value) return
    runLayout()
}

const trans = (key: string) => {
    return i18n.value[key] || key
}

const downloadPng = () => {
    downloadDropdown.value = false
    if (!cy.value) {
        return
    }
    const options = {
        full: true,
        bg: cssVariable('--b1'),
    };
    const base64 = cy.value.png(options);

    const link = document.createElement('a');
    link.href = base64;
    link.download = `${trans('campaign')}-web-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

const downloadPdf = async () => {
    downloadDropdown.value = false
    if (!cy.value) {
        return
    }

    const { jsPDF } = await import('jspdf')

    const base64 = cy.value.png({
        full: true,
        bg: cssVariable('--b1'),
    });

    const img = new Image();
    img.src = base64;
    await new Promise((resolve) => { img.onload = resolve; });

    const landscape = img.width > img.height;
    const doc = new jsPDF({
        orientation: landscape ? 'landscape' : 'portrait',
        unit: 'px',
        format: [img.width, img.height],
    });

    doc.addImage(base64, 'PNG', 0, 0, img.width, img.height);
    doc.save(`${trans('campaign')}-web-${Date.now()}.pdf`);
}

</script>
