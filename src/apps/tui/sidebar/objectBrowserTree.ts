import type { ObjectInfo, QueryableObjectInfo } from "#domain/objects"

export type ObjectBrowserNode = {
  id: string
  kind: ObjectInfo["type"]
  label: string
  badge?: string
  automatic?: boolean
  defaultExpanded?: boolean
  children: ObjectBrowserNode[]
}

const MISSING_OBJECT_PARENT_KEY = "<none>"

export function buildObjectBrowserTree(objects: readonly ObjectInfo[]): ObjectBrowserNode[] {
  const nodes = objects.map((object, index) => createObjectBrowserNode(object, index))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const roots: ObjectBrowserNode[] = []

  for (const [index, object] of objects.entries()) {
    const node = nodes[index]
    if (!node) {
      continue
    }

    const parent = objectParentIds(object)
      .map((parentId) => nodeById.get(parentId))
      .find((candidate): candidate is ObjectBrowserNode => candidate !== undefined)

    if (parent) {
      parent.children.push(node)
      continue
    }

    roots.push(node)
  }

  sortObjectBrowserNodes(roots)
  return roots
}

function createObjectBrowserNode(object: ObjectInfo, index: number): ObjectBrowserNode {
  return {
    id: objectNodeId(object, index),
    kind: object.type,
    label: objectBrowserLabel(object),
    badge: objectBrowserBadge(object),
    automatic: object.automatic,
    defaultExpanded: objectDefaultExpanded(object),
    children: [],
  }
}

function objectBrowserLabel(object: ObjectInfo): string {
  switch (object.type) {
    case "database":
      return object.name
    case "schema":
      return `schema ${object.name}`
    case "table":
      return object.name
    case "view":
      return `view ${object.name}`
    case "matview":
      return `matview ${object.name}`
    case "index":
      return object.name
    case "trigger":
      return `trigger on ${object.on.name}`
  }
}

function objectBrowserBadge(object: ObjectInfo): string | undefined {
  switch (object.type) {
    case "database":
      return "db"
    case "table":
      return "tbl"
    case "index":
      return "idx"
    case "schema":
    case "view":
    case "matview":
    case "trigger":
      return undefined
  }
}

function objectParentIds(object: ObjectInfo): string[] {
  switch (object.type) {
    case "database":
      return []
    case "schema":
      return object.database ? [databaseNodeId(object.database)] : []
    case "table":
    case "view":
    case "matview":
      return [
        ...(object.schema ? [schemaNodeId(object.database, object.schema)] : []),
        ...(object.database ? [databaseNodeId(object.database)] : []),
      ]
    case "index":
    case "trigger":
      return [
        queryableNodeId(object.on),
        ...(object.on.schema ? [schemaNodeId(object.on.database, object.on.schema)] : []),
        ...(object.on.database ? [databaseNodeId(object.on.database)] : []),
      ]
  }
}

function objectNodeId(object: ObjectInfo, index: number): string {
  switch (object.type) {
    case "database":
      return databaseNodeId(object.name)
    case "schema":
      return schemaNodeId(object.database, object.name)
    case "table":
    case "view":
    case "matview":
      return queryableNodeId(object)
    case "index":
      return `index:${queryableNodeId(object.on)}:${object.name}:${index}`
    case "trigger":
      return `trigger:${queryableNodeId(object.on)}:${index}`
  }
}

function objectDefaultExpanded(object: ObjectInfo): boolean | undefined {
  switch (object.type) {
    case "database":
    case "schema":
      return true
    case "table":
      return false
    case "view":
    case "matview":
    case "index":
    case "trigger":
      return undefined
  }
}

function databaseNodeId(name: string): string {
  return `database:${name}`
}

function schemaNodeId(database: string | undefined, name: string): string {
  return `schema:${database ?? MISSING_OBJECT_PARENT_KEY}:${name}`
}

function queryableNodeId(object: QueryableObjectInfo): string {
  return `${object.type}:${object.database ?? MISSING_OBJECT_PARENT_KEY}:${object.schema ?? MISSING_OBJECT_PARENT_KEY}:${object.name}`
}

function sortObjectBrowserNodes(nodes: ObjectBrowserNode[]) {
  nodes.sort((left, right) => Number(left.automatic === true) - Number(right.automatic === true))

  for (const node of nodes) {
    if (node.children.length > 0) {
      sortObjectBrowserNodes(node.children)
    }
  }
}
