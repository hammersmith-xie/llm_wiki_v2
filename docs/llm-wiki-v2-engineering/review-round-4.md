# Governance / Tauri Permission Review

## Scope

- `src-tauri/capabilities/default.json`
- `src-tauri/tauri.conf.json`
- `src/lib/audit-redaction.ts`
- Search, LLM provider, web search, clip server, file preview, and dialog/open/store usage paths.

## Decisions

### HTTP plugin scope

Tauri HTTP permissions use URL glob scopes and reject requests outside configured scope:
https://v2.tauri.app/zh-cn/reference/javascript/http/

The app intentionally allows user-configured LLM, embedding, vision, web search, proxy, and on-prem endpoints. Restricting to fixed hosts would break supported workflows, especially local gateways and enterprise endpoints. The effective allow scope therefore remains HTTP(S), but the capability file now removes redundant overlapping glob entries and keeps only:

```json
{ "url": "http://**" }
{ "url": "https://**" }
```

### Asset protocol scope

Tauri asset protocol scope controls which filesystem paths can be loaded through the asset protocol:
https://tauri.app/ja/reference/config/#assetprotocolconfig

`assetProtocol.scope` remains `["**"]` for now. The app previews images/media from arbitrary user-selected project folders and raw sources via `convertFileSrc(filePath)`. A static `$HOME/**` or `$DOCUMENT/**` scope would break projects on external volumes, shared drives, and non-standard work directories.

Future hardening path: broker asset URLs through a project-bound resolver or persist selected project roots into a dynamic allow scope if Tauri exposes a safe runtime path-scoping flow for this use case.

### CSP

`connect-src 'self' https: http:` remains unchanged. Browser `fetch` is used for the local clip server at `127.0.0.1:19827`, while the Tauri HTTP plugin covers CORS-hostile third-party/provider calls. Removing `http:` would break local providers and the clip bridge.

### Dialog / opener / store

`dialog:default`, `opener:default`, and `store:default` are retained because the frontend uses file/folder pickers, external/open page flows, and persisted app state.

## Audit Redaction

Added credential redaction for URLs with embedded userinfo, such as:

```text
http://user:password@proxy.internal:8080
https://user:token@example.com/v1/chat
```

These now become:

```text
http://[REDACTED:secret]@proxy.internal:8080
https://[REDACTED:secret]@example.com/v1/chat
```

This covers proxy config, provider endpoint mistakes, and request/audit reasons that may include a full credentialed URL.

## Verification

- `npx vitest run src/lib/audit-redaction.test.ts`
- `node -e "JSON.parse(require('fs').readFileSync('src-tauri/capabilities/default.json','utf8')); JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8'))"`
- `npm run typecheck`
- `npm run test:mocks`
