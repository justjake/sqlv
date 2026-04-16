import { describe, expect, test } from "bun:test"
import { parseIntoClientConfig } from "pg-connection-string"
import type { Protocol } from "../../src/spi/Adapter"
import {
  PostgresAdapter,
  postgres,
  postgresqlProtocolResolver,
  resolvePostgresConfig,
} from "../../src/adapters/postgres/PgAdapter"

const RoundTripDSNs = [
  "postgresql://alice:s3cret@db.example.com:5432/app",
  "postgres://alice@db.example.com/app",
  "postgresql:///app?host=/var/run/postgresql",
  "postgresql://alice:s3cret@/app?host=/var/run/postgresql&port=5433",
  "postgresql://al%20ice:p%40ss%2Fword@[2001:db8::1]:6543/app?application_name=sqlv&ssl=true",
  "postgresql://db.example.com/app?sslmode=disable&client_encoding=UTF8",
  "postgresql://alice@db.example.com/app?options=-c%20search_path%3Dpublic&fallback_application_name=sqlv-cli",
  "postgresql://alice@db.example.com/my%2Fdb?sslmode=no-verify",
  "postgresql://alice@db.example.com/app?ssl=true&application_name=sqlv&options=-c%20statement_timeout%3D5000",
] as const

describe("postgres adapter helpers", () => {
  test("renders postgres SQL with positional parameters", () => {
    expect(postgres`select ${1} as value, ${true} as enabled`.toSource()).toBe("select $1 as value, $2 as enabled")
    expect(postgres`select ${1} as value, ${true} as enabled`.getArgs()).toEqual([1, true])
  })

  test("delegates postgres config parsing to pg-connection-string", () => {
    const dsn = "postgresql://alice:s3cret@db.example.com:5432/app?ssl=true&application_name=sqlv"
    const expected = {
      connectionString: dsn,
      ...parseIntoClientConfig(dsn),
    }

    expect(resolvePostgresConfig(dsn)).toEqual(expected)
  })

  test("resolves postgresql protocol configs", () => {
    const dsn = "postgresql://alice:s3cret@db.example.com:5432/app?sslmode=disable"
    const protocol: Protocol = postgresqlProtocolResolver.protocol

    expect(protocol).toBe("postgresql")
    expect(postgresqlProtocolResolver.protocol).toBe("postgresql")
    expect(postgresqlProtocolResolver.resolve(dsn)).toEqual({
      protocol: "postgresql",
      config: {
        connectionString: dsn,
        ...parseIntoClientConfig(dsn),
      },
    })
  })

  test("round-trips parsed postgres URIs exactly", () => {
    const adapter = new PostgresAdapter()
    const spec = adapter.getConnectionSpec()

    expect(adapter.protocol).toBe("postgresql")
    expect(adapter.sqlFormatterLanguage).toBe("postgresql")

    for (const dsn of RoundTripDSNs) {
      const config = spec.fromURI?.(dsn)

      expect(config).toEqual({
        connectionString: dsn,
        ...parseIntoClientConfig(dsn),
      })
      expect(config).toBeDefined()
      expect(spec.toURI?.(config!)).toBe(dsn)
    }
  })

  test("serializes configs without original connection strings", () => {
    const spec = new PostgresAdapter().getConnectionSpec()
    const passwordOnlyURI = spec.toURI?.({
      connectionString: undefined,
      database: "app",
      host: "db.example.com",
      password: "s3cret",
    })

    expect(
      spec.toURI?.({
        application_name: "sqlv",
        client_encoding: "UTF8",
        connectionString: undefined,
        database: "app",
        fallback_application_name: "psql",
        host: "db.example.com",
        options: "-c search_path=public",
        password: "p@ss/word",
        port: 6543,
        ssl: true,
        user: "alice",
      }),
    ).toBe(
      "postgresql://alice:p%40ss%2Fword@db.example.com:6543/app?application_name=sqlv&client_encoding=UTF8&options=-c+search_path%3Dpublic&fallback_application_name=psql&ssl=true",
    )
    expect(
      spec.toURI?.({
        connectionString: undefined,
        database: "app",
        host: "/var/run/postgresql",
        password: "s3cret",
        port: 5433,
        ssl: false,
        user: "alice",
      }),
    ).toBe("postgresql://alice:s3cret@/app?host=%2Fvar%2Frun%2Fpostgresql&port=5433&sslmode=disable")
    expect(passwordOnlyURI).toBe("postgresql://db.example.com/app?password=s3cret")
    expect(spec.fromURI?.(passwordOnlyURI!)).toEqual({
      connectionString: passwordOnlyURI,
      ...parseIntoClientConfig(passwordOnlyURI!),
    })
  })

  test("provides adapter helpers for describeConfig and form config creation", () => {
    const adapter = new PostgresAdapter()
    const spec = adapter.getConnectionSpec()

    expect(
      adapter.describeConfig({
        database: "app",
        host: "db.example.com",
        port: 5432,
        ssl: true,
        user: "alice",
      }),
    ).toBe("alice@db.example.com:5432/app (ssl)")
    expect(adapter.renderSQL(postgres`select ${1} as value`)).toEqual({
      args: [1],
      source: "select $1 as value",
    })
    expect(
      spec.createConfig({
        application_name: "sqlv",
        database: "app",
        host: "db.example.com",
        password: "s3cret",
        port: "5432",
        ssl: true,
        user: "alice",
      }),
    ).toEqual({
      application_name: "sqlv",
      connectionString: "postgresql://alice:s3cret@db.example.com:5432/app?application_name=sqlv&ssl=true",
      database: "app",
      host: "db.example.com",
      password: "s3cret",
      port: 5432,
      ssl: true,
      user: "alice",
    })
  })

  test("finds local postgres port suggestions", async () => {
    const suggestions = await new PostgresAdapter({
      findPorts: async () => [5432, 15432],
    }).findConnections()

    expect(suggestions).toEqual([
      {
        config: {
          database: "postgres",
          host: "localhost",
          port: 5432,
        },
        name: "localhost:5432",
      },
      {
        config: {
          database: "postgres",
          host: "localhost",
          port: 15432,
        },
        name: "localhost:15432",
      },
    ])
  })
})
