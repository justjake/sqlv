import { describe, expect, test } from "bun:test"

import { buildObjectBrowserTree, type ObjectBrowserNode } from "./objectBrowserTree"

function treeShape(nodes: readonly ObjectBrowserNode[]): unknown[] {
  return nodes.map(({ automatic, badge, children, defaultExpanded, kind, label }) => ({
    kind,
    label,
    ...(badge === undefined ? {} : { badge }),
    ...(automatic === true ? { automatic } : {}),
    ...(defaultExpanded === undefined ? {} : { defaultExpanded }),
    ...(children.length > 0 ? { children: treeShape(children) } : {}),
  }))
}

describe("object browser tree", () => {
  test("nests database objects under databases, schemas, and tables", () => {
    const nodes = buildObjectBrowserTree([
      { name: "main", type: "database" },
      { database: "main", name: "public", type: "schema" },
      { database: "main", name: "users", schema: "public", type: "table" },
      {
        name: "users_email_idx",
        on: { database: "main", name: "users", schema: "public", type: "table" },
        type: "index",
      },
      {
        automatic: true,
        name: "sqlite_autoindex_users_1",
        on: { database: "main", name: "users", schema: "public", type: "table" },
        type: "index",
      },
      {
        on: { database: "main", name: "users", schema: "public", type: "table" },
        type: "trigger",
      },
      { database: "main", name: "audit_log", schema: undefined, type: "table" },
      {
        name: "audit_log_created_at_idx",
        on: { database: "main", name: "audit_log", schema: undefined, type: "table" },
        type: "index",
      },
      { database: "main", name: "active_users", schema: undefined, type: "view" },
    ])

    expect(treeShape(nodes)).toEqual([
      {
        kind: "database",
        label: "main",
        badge: "db",
        defaultExpanded: true,
        children: [
          {
            kind: "schema",
            label: "schema public",
            defaultExpanded: true,
            children: [
              {
                kind: "table",
                label: "users",
                badge: "tbl",
                defaultExpanded: false,
                children: [
                  { kind: "index", label: "users_email_idx", badge: "idx" },
                  { kind: "trigger", label: "trigger on users" },
                  { kind: "index", label: "sqlite_autoindex_users_1", badge: "idx", automatic: true },
                ],
              },
            ],
          },
          {
            kind: "table",
            label: "audit_log",
            badge: "tbl",
            defaultExpanded: false,
            children: [{ kind: "index", label: "audit_log_created_at_idx", badge: "idx" }],
          },
          { kind: "view", label: "view active_users" },
        ],
      },
    ])
  })
})
