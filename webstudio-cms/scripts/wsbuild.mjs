// Webstudio native build-object generator.
// Constructs pages/instances/styles/props in the exact schema Webstudio stores.
// This is the supported path we chose (editor clicks were too fragile).
//
// Webstudio stores breakpoints in the native `breakpoints` column; the always-on
// one is labeled "Base". Resolve its id at runtime from the loaded build - do not
// hardcode a breakpoint id (they differ per instance). See usage below.
import { randomBytes } from 'node:crypto'

// Generate a Webstudio-style id (alphanumeric, no reserved chars like ':')
export const uid = (n = 22) => randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n)

export const inst = (component, tag, children = []) => ({
  type: 'instance',
  id: uid(),
  component,
  children,
  ...(tag ? { tag } : {}),
})

export const textChild = (value) => ({ type: 'text', value })
export const idChild = (value) => ({ type: 'id', value })

// helpers for style values
export const kw = (value) => ({ type: 'keyword', value })
export const unit = (value, unit = 'px') => ({ type: 'unit', unit, value })
export const color = (hex) => {
  const h = hex.replace('#', '')
  return { type: 'color', colorSpace: 'hex', components: [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255], alpha: 1 }
}
export const len = (value, unit = 'px') => ({ type: 'unit', unit, value })

// style declaration
export const styleDecl = (breakpointId, styleSourceId, property, value) => ({
  breakpointId, styleSourceId, property, value,
})

// prop declaration
export const prop = (instanceId, name, type, value) => ({
  id: `${instanceId}:${name}`,
  instanceId, name, type, value,
})

// A build object we assemble then commit.
export class Build {
  constructor() {
    this.instances = []
    this.styleSources = []
    this.styles = []
    this.breakpoints = []
    this.styleSourceSelections = []
    this.props = []
    this.pages = { homePageId: null, rootFolderId: 'root', pages: [], folders: [{ id: 'root', name: 'Root', slug: '', children: [] }] }
    this._byId = new Map()
  }
  addInstance(i) { this.instances.push(i); this._byId.set(i.id, i); return i }
  getInstance(id) { return this._byId.get(id) }
  localSource(instanceId) { return `${instanceId}:ws:style` }
  addLocalSource(instanceId) { this.styleSources.push({ type: 'local', id: this.localSource(instanceId) }) }
  addTokenSource(id, name) { this.styleSources.push({ type: 'token', id, name }) }
  addStyle(bp, ssid, property, value) { this.styles.push(styleDecl(bp, ssid, property, value)) }
  addProp(iid, name, type, value) { this.props.push(prop(iid, name, type, value)) }
  addPage({ id, name, title, rootInstanceId, path, meta = {} }) {
    this.pages.pages.push({ id, name, title: JSON.stringify(title), rootInstanceId, meta, path })
    this.pages.folders[0].children.push(id)
  }
}

// Resolve the native "Base" breakpoint id from the loaded build's `breakpoints`:
//   const bps = JSON.parse(load('breakpoints'))
//   const base = bps.find(b => b.label === 'Base').id
//   // then use `base` wherever a breakpointId is required.
