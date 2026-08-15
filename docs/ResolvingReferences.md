# Working with `$ref` across files

OpenAPI/Swagger specs can define a schema, parameter, or response once and reuse it everywhere via
`$ref` — including reuse **across files**, not just within one document. This page covers how that
works and three different ways to see (or export) the fully expanded result.

## Referencing components in another file

A `$ref` value isn't limited to a local JSON Pointer like `#/components/schemas/Pet` — it can also
be a URL pointing at a schema/parameter/response defined in a completely different spec:

```yaml
paths:
  /pets:
    get:
      responses:
        '200':
          description: A pet
          content:
            application/json:
              schema:
                $ref: 'https://example.com/common-schemas.yaml#/components/schemas/Pet'
```

The part before the `#` is the file (any URL reachable from the browser — a raw file on GitHub, a
teammate's spec, a shared "common types" file your org maintains); the part after the `#` is a
JSON Pointer into that file, same as a local `$ref`. This is exactly what lets several
microservices share one canonical set of schemas instead of copy-pasting them, and it's a plain
OpenAPI feature — nothing app-specific about the syntax itself. (This app's own
[aggregation feature](Design.md#aggregation-set-storage) is a related but separate thing — it
merges several *whole specs* into one under distinct tags, rather than resolving `$ref`s inside a
single spec.)

## Two different outcomes: fully dereferenced vs. bundled

There isn't just one "expanded" form — there are two, and they're useful for different things:

- **Fully dereferenced**: every `$ref`, local or cross-file, is replaced with the actual content it
  points to, inline, everywhere it's used. No `$ref`s remain anywhere. Simple to reason about, but
  if the same schema is reused in five places, you now have five duplicated copies of it.
- **Bundled**: every file gets merged into one, so no `$ref` ever crosses a file boundary anymore —
  but `$ref`s *within* that one file are left alone. A schema reused five times is still defined
  once and referenced five times; it just no longer needs a second file to do it. This is the
  **best-practice output** for handing a spec to another tool or team: portable (one file) without
  giving up the DRY-ness `$ref` exists for in the first place.

### 1. File menu → Download Resolved JSON/YAML (fully dereferenced)

**File → Download Resolved JSON** (or **Download Resolved YAML**) fully dereferences every `$ref` —
local and cross-file — and downloads the result as a single file. No network round trip beyond
fetching the referenced files themselves.

### 2. Command Palette (F1) → "Resolve document" (fully dereferenced)

Press **F1** with the editor focused — this opens Monaco's built-in Command Palette (the same F1
you'd get in VS Code; this app doesn't override it). Type "resolve" and pick **Resolve document**.
Same full dereferencing as the download option, but it replaces the *editor's own content* in
place, so you can keep scrolling/searching/editing the expanded version live instead of opening a
downloaded file. (Undo (`Ctrl+Z`) puts back the `$ref`-based version afterward, same as any other
edit — see [KeyboardShortcuts.md](KeyboardShortcuts.md).)

### 3. Generate Client → `openapi`/`openapi-yaml` (or `swagger`/`swagger-yaml`) (bundled)

A less obvious but genuinely useful trick: the **Generate Client** menu's language list isn't only
programming languages. Alongside `python`, `typescript-axios`, `java`, etc., the public generator
service also offers **`openapi`** and **`openapi-yaml`** for OpenAPI 3 specs (**`swagger`** and
**`swagger-yaml`** for OpenAPI 2/Swagger 2.0 specs) — these are "meta" targets that, instead of
generating client code, hand back a *bundled* copy of the spec as JSON or YAML, zipped up like any
other generated client. Pick your spec's version menu (**OpenAPI 3** or **OpenAPI 2**) →
**Generate Client** → `openapi-yaml`/`swagger-yaml` (or the JSON variants), and you get a portable
single-file spec produced by the same public `generator3.swagger.io`/`generator.swagger.io` service
the app already uses for real client/server generation — no separate tool or setup required.

**Worked example** — a spec whose response schema is a two-hop cross-file `$ref` chain
(`main` → `User` in one file → `User.order` → `Order` in a second file) comes back from this trick
looking like:

```json
{
  "paths": {
    "/order-with-user": {
      "get": {
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/User" }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "User": {
        "type": "object",
        "properties": {
          "order": { "$ref": "#/components/schemas/Order" }
        }
      },
      "Order": { "type": "object" }
    }
  }
}
```

Both `User` and `Order` got hoisted into this one file's `components/schemas` — the two hops
across files collapsed into zero — but the `$ref` from `User.order` to `Order` is still a `$ref`,
not an inlined copy. That's the bundling behavior in one file: single-file portability, still DRY.
