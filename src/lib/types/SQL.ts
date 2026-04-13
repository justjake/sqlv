export class Argument<T> {
  constructor(
    public readonly value: T,
    public readonly name?: string,
  ) {}
}

export class Identifier {
  constructor(
    public readonly name: string,
    public readonly schema?: string,
    public readonly database?: string,
    public readonly connection?: string,
  ) {}
}

export type Namespace = {
  connection?: string
  database?: string
  schema?: string
}

export type SQLFragment<Arg> = string | Argument<Arg> | Identifier | SQL<unknown, Arg>
export type SQLValue<Arg> = SQL<unknown, Arg> | Argument<Arg> | Identifier | Arg

type RenderState = {
  nextArgIndex: number
}

type RenderContext<Arg> = {
  renderArgument: (argument: Argument<Arg>, index: number) => string
  renderIdentifier: (identifier: Identifier) => string
  renderString?: (fragment: string) => string
}

export type SQLSourceOptions<Arg> = {
  renderArg?: (index: number, arg: Arg) => string
  renderIdentifier?: (identifier: Identifier) => string
}

export class SQL<Row = unknown, Arg = unknown> {
  queryName?: string
  queryNamespace?: Namespace
  declare readonly __row?: Row

  constructor(public readonly fragments: SQLFragment<Arg>[] = []) {}

  toString(): string {
    return `sql\`${fragmentsToString(this.fragments)}\``
  }

  toSource({
    renderArg = defaultRenderArg,
    renderIdentifier = defaultRenderIdentifier,
  }: SQLSourceOptions<Arg> = {}): string {
    return renderFragments(this.fragments, {
      renderArgument: (argument, index) => renderArg(index, argument.value),
      renderIdentifier,
    })
  }

  getArgs(): Arg[] {
    const args: Arg[] = []

    collectArgs(this.fragments, args)

    return args
  }

  clone(): SQL<Row, Arg> {
    return new SQL(this.fragments)
  }

  named(queryName: string): SQL<Row, Arg> {
    const clone = this.clone()
    clone.queryName = queryName
    return clone
  }

  namespaced(namespace: Namespace): SQL<Row, Arg> {
    const clone = this.clone()
    clone.queryNamespace = namespace
    return clone
  }
}

export function ident(name: string, { schema, database, connection }: Namespace = {}): Identifier {
  return new Identifier(name, schema, database, connection)
}

/**
 * Returns a human-readable string representation of the fragments.
 * Not used for executing SQL
 *
 * Arguments should be named `$name` or `$indexAmongArgs` if no name is provided.
 * (Args with a name still increment the index)
 */
function fragmentsToString<Arg>(fragments: SQLFragment<Arg>[]): string {
  return renderFragments(fragments, {
    renderArgument: (argument, index) => {
      if (argument.name !== undefined) {
        return `$${argument.name}`
      }

      return `$${index}`
    },
    renderIdentifier: defaultRenderIdentifier,
    renderString: escapeTemplateText,
  })
}

/**
 * Template string literal for SQL.
 */
export function sql<Row = unknown, Arg = unknown>(
  strings: TemplateStringsArray,
  ...values: Array<SQLValue<Arg>>
): SQL<Row, Arg> {
  const fragments: SQLFragment<Arg>[] = []

  for (const [index, stringFragment] of strings.entries()) {
    if (stringFragment.length > 0) {
      fragments.push(stringFragment)
    }

    if (index < values.length) {
      fragments.push(normalizeValue(values[index]!))
    }
  }

  return new SQL<Row, Arg>(fragments)
}

function normalizeValue<Arg>(value: SQLValue<Arg>): SQLFragment<Arg> {
  if (value instanceof SQL || value instanceof Argument || value instanceof Identifier) {
    return value
  }

  return new Argument(value)
}

function renderFragments<Arg>(
  fragments: SQLFragment<Arg>[],
  context: RenderContext<Arg>,
  state: RenderState = { nextArgIndex: 1 },
): string {
  let source = ""

  for (const fragment of fragments) {
    if (typeof fragment === "string") {
      source += context.renderString?.(fragment) ?? fragment
      continue
    }

    if (fragment instanceof SQL) {
      source += renderFragments(fragment.fragments, context, state)
      continue
    }

    if (fragment instanceof Identifier) {
      source += context.renderIdentifier(fragment)
      continue
    }

    source += context.renderArgument(fragment, state.nextArgIndex)
    state.nextArgIndex += 1
  }

  return source
}

function collectArgs<Arg>(fragments: SQLFragment<Arg>[], args: Arg[]): void {
  for (const fragment of fragments) {
    if (typeof fragment === "string" || fragment instanceof Identifier) {
      continue
    }

    if (fragment instanceof SQL) {
      collectArgs(fragment.fragments, args)
      continue
    }

    args.push(fragment.value)
  }
}

// TODO: this is unnecessary, template literal syntax like `${foo}` never appears in strings we inspect
function escapeTemplateText(fragment: string): string {
  return fragment.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")
}

function defaultRenderArg(index: number, _arg: unknown): string {
  return `$${index}`
}

// TODO: connections are a concept within our application, and they start with an `@`
// eg @sqldb.<table>
function defaultRenderIdentifier(identifier: Identifier): string {
  return [identifier.connection, identifier.database, identifier.schema, identifier.name]
    .filter((part): part is string => part !== undefined)
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(".")
}

export type PaginatedParams = { limit: number; cursor: object }

export class Paginated<Params extends PaginatedParams, Row, Arg> {
  constructor(
    public readonly query: (params: Params) => SQL<Row, Arg>,
    public readonly cursor: (row: Row) => Params["cursor"],
    public readonly count?: (params: Params) => SQL<{ count: number }, Arg>,
  ) {}
}
