import { format, type SqlLanguage } from "sql-formatter"

const DEFAULT_SQL_FORMATTER_LANGUAGE: SqlLanguage = "sql"

export function formatQueryText(text: string, language?: string): string {
  return format(text, {
    language: normalizeSqlFormatterLanguage(language),
  })
}

export function normalizeSqlFormatterLanguage(language: string | undefined): SqlLanguage {
  if (!language) {
    return DEFAULT_SQL_FORMATTER_LANGUAGE
  }

  switch (language) {
    case "bigquery":
    case "clickhouse":
    case "db2":
    case "db2i":
    case "duckdb":
    case "hive":
    case "mariadb":
    case "mysql":
    case "n1ql":
    case "plsql":
    case "postgresql":
    case "redshift":
    case "singlestoredb":
    case "snowflake":
    case "spark":
    case "sql":
    case "sqlite":
    case "tidb":
    case "transactsql":
    case "trino":
    case "tsql":
      return language
    default:
      return DEFAULT_SQL_FORMATTER_LANGUAGE
  }
}
