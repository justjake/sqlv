export type ObjectInfo = DatabaseInfo | SchemaInfo | QueryableObjectInfo | IndexInfo | TriggerInfo
export type QueryableObjectInfo = TableInfo | ViewInfo | MaterializedViewInfo

type ObjectInfoBase = {
  automatic?: boolean
}

export type DatabaseInfo = ObjectInfoBase & {
  type: "database"
  name: string
  file?: string
}

export type SchemaInfo = ObjectInfoBase & {
  type: "schema"
  database: string | undefined
  name: string
}

export type TableInfo = ObjectInfoBase & {
  type: "table"
  database: string | undefined
  schema: string | undefined
  name: string
}

export type ViewInfo = ObjectInfoBase & {
  type: "view"
  database: string | undefined
  schema: string | undefined
  name: string
}

export type MaterializedViewInfo = ObjectInfoBase & {
  type: "matview"
  database: string | undefined
  schema: string | undefined
  name: string
}

export type IndexInfo = ObjectInfoBase & {
  type: "index"
  name: string
  on: QueryableObjectInfo
}

export type TriggerInfo = ObjectInfoBase & {
  type: "trigger"
  on: QueryableObjectInfo
}
