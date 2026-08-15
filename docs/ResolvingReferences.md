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

## Seeing the fully resolved spec

Editing is easier when every `$ref` is still a pointer — you only change a schema in one place. But
sometimes you want the *expanded* version: to hand to a tool that doesn't follow cross-file refs,
to sanity-check what a consumer actually sees, or just to read the whole thing in one place. Three
ways to get that, from quickest to most portable:

### 1. File menu → Download Resolved JSON/YAML

The most direct route: **File → Download Resolved JSON** (or **Download Resolved YAML**) resolves
every `$ref` — local and cross-file — and downloads the result as a single file. No network round
trip beyond fetching the referenced files themselves.

### 2. Command Palette (F1) → "Resolve document"

Press **F1** with the editor focused — this opens Monaco's built-in Command Palette (the same F1
you'd get in VS Code; this app doesn't override it). Type "resolve" and pick **Resolve document**.
Unlike the download option, this replaces the *editor's own content* with the expanded spec in
place, so you can keep scrolling/searching/editing the resolved version live instead of opening a
downloaded file. (Undo (`Ctrl+Z`) puts back the `$ref`-based version afterward, same as any other
edit — see [KeyboardShortcuts.md](KeyboardShortcuts.md).)

### 3. Generate Client → `openapi`/`openapi-yaml` (or `swagger`/`swagger-yaml`)

A less obvious but genuinely useful trick: the **Generate Client** menu's language list isn't only
programming languages. Alongside `python`, `typescript-axios`, `java`, etc., the public generator
service also offers **`openapi`** and **`openapi-yaml`** for OpenAPI 3 specs (**`swagger`** and
**`swagger-yaml`** for OpenAPI 2/Swagger 2.0 specs) — these are "meta" targets that, instead of
generating client code, hand back a bundled, fully-resolved copy of the spec itself as JSON or
YAML, zipped up like any other generated client. Pick your spec's version menu (**OpenAPI 3** or
**OpenAPI 2**) → **Generate Client** → `openapi-yaml`/`swagger-yaml` (or the JSON variants), and
you get a portable, ref-free copy of the spec produced by the same public
`generator3.swagger.io`/`generator.swagger.io` service the app already uses for real client/server
generation — no separate tool or setup required.
