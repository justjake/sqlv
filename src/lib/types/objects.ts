export type ObjectInfo = DatabaseInfo | SchemaInfo | QueryableObjectInfo | IndexInfo | TriggerInfo
export type QueryableObjectInfo = TableInfo | ViewInfo | MaterializedViewInfo

export type DatabaseInfo = {
  type: "database"
  name: string
  file?: string
}

export type SchemaInfo = {
  type: "schema"
  database: string | undefined
  name: string
}

export type TableInfo = {
  type: "table"
  database: string | undefined
  schema: string | undefined
  name: string
}

export type ViewInfo = {
  type: "view"
  database: string | undefined
  schema: string | undefined
  name: string
}

export type MaterializedViewInfo = {
  type: "matview"
  database: string | undefined
  schema: string | undefined
  name: string
}

export type IndexInfo = {
  type: "index"
  on: QueryableObjectInfo
}

export type TriggerInfo = {
  type: "trigger"
  on: QueryableObjectInfo
}
