# Aggregation: merging multiple specs into one

This is a different feature from [`$ref` bundling](ResolvingReferences.md) — bundling collapses
`$ref`s *within one spec* that happen to cross files. Aggregation is for combining several
**independent, whole specs** — typically one per microservice — into a single merged spec, via the
**Aggregate** menu. Nothing here needs `$ref` at all; each source spec is a complete document on
its own.

## Using it

1. **Aggregate → Manage Aggregation Sets.** The modal's **Storage location** fields (owner/repo/
   branch) control where sets are saved — defaults to this app's own repo's `aggregation-data`
   branch; see [Design.md](Design.md#aggregation-set-storage). A read-only visitor can still browse
   and aggregate existing sets; only saving/editing/deleting needs write access (see
   [Permissions.md](Permissions.md)).
2. **New Set**, give it a name, and add one **Service name** + **Swagger URL** pair per
   microservice you want merged in. **Save Set**.
3. Click **Aggregate** on the saved set. The merge result is loaded straight into the active tab,
   and a status line reports how it went, e.g.:

   > Loaded "Public API" into the editor: 2 spec(s) merged, resolved 2 naming conflicts.

   A service whose URL can't be fetched doesn't block the rest — it's called out by name in the
   status line instead (`(1 URL failed: <name>)`), and everything that *did* fetch still gets
   merged.

## Conflict-resolution rules

Paths, tags, and each `components/*` sub-collection (`schemas`, `responses`, `parameters`,
`examples`, `requestBodies`, `headers`, `securitySchemes`, `links`, `callbacks`) are each tracked
**independently** for name collisions across services — a `Widget` schema in one service and a
`Widget` response in another don't collide with each other just because they share a name.

- **No collision** (name only exists in one service): passed through unchanged.
- **Collision** (name exists in two or more services): every occurrence gets prefixed with the
  owning service's name (lowercased, non-alphanumeric characters stripped):
  - Path: `/health` → `/<service><path>`, e.g. `/users/health`.
  - Tag: `API` → `<service>-<tag>`, e.g. `users-API`, with `(from <service>)` appended to its
    description so it's still clear what it originally was.
  - Component: `Widget` → `<service><ComponentName>`, e.g. `usersWidget`.

Merged `info.title` is the aggregation set's own name; `info.version` is always `1.0.0`
(aggregation doesn't try to reconcile source specs' differing versions); `info.description`
auto-lists which services were merged.

## Worked example

Two independent services. Both happen to expose a `/health` path under an `API` tag (a collision),
and each also has its own distinct path and schema (not a collision):

**`users` service** (Service name: `users`):

```yaml
openapi: 3.0.0
info:
  title: Users Service
  version: "1.0.0"
tags:
  - name: API
    description: Users endpoints
paths:
  /health:
    get:
      tags: [API]
      responses:
        '200':
          description: OK
  /users:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
```

**`orders` service** (Service name: `orders`):

```yaml
openapi: 3.0.0
info:
  title: Orders Service
  version: "1.0.0"
tags:
  - name: API
    description: Orders endpoints
paths:
  /health:
    get:
      tags: [API]
      responses:
        '200':
          description: OK
  /orders:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
components:
  schemas:
    Order:
      type: object
      properties:
        id:
          type: integer
```

Saved as a set named **"Public API"** and aggregated, the result — this is real output from
`mergeSpecs`, not hand-written — is:

```yaml
openapi: 3.0.0
info:
  title: Public API
  version: 1.0.0
  description: 'Aggregated API from 2 microservices: users, orders'
paths:
  /users/health:
    get:
      tags:
        - users-API
      responses:
        '200':
          description: OK
  /users:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
  /orders/health:
    get:
      tags:
        - orders-API
      responses:
        '200':
          description: OK
  /orders:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
    Order:
      type: object
      properties:
        id:
          type: integer
tags:
  - name: users-API
    description: Users endpoints (from users)
  - name: orders-API
    description: Orders endpoints (from orders)
```

`/health` and the `API` tag existed in both services, so every occurrence got prefixed with its
owning service's name. `/users`, `/orders`, `User`, and `Order` were each unique to one service, so
they passed straight through untouched. The status line for this aggregation would read
`resolved 2 naming conflicts` — one path collision (`/health`) plus one tag collision (`API`); zero
component collisions, since `User` and `Order` never shared a name.
