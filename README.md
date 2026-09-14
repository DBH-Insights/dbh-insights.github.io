# DBH Insights

A vCenter inventory website that anyone can open, backed by a small helper app each user runs on their own machine.

```
 Browser (your hosted website)          User's machine                  Local network
 ┌──────────────────────────┐   fetch   ┌─────────────────────┐  HTTPS  ┌──────────┐
 │ collect/ UI, sheets, all │ ────────▶ │ helper/  Tauri+Rust │ ──────▶ │ vCenter  │
 │ REST + SOAP query logic  │ ◀──────── │ 127.0.0.1:8765      │ ◀────── │ REST+SOAP│
 │ (updates instantly)      │           │ creds in OS keychain│         │ (self-   │
 └──────────────────────────┘           └─────────────────────┘         │  signed) │
                                                                        └──────────┘
```

- **`collect/`**: the website. Plain HTML/JS, no build step. Every vCenter query is defined here, so new sheets, columns, and layouts ship by redeploying the site.
- **`helper/`**: the desktop helper. It has a settings window where you add, edit, test, and delete any number of vCenters, lives in the system tray, and exposes a pass-through on `127.0.0.1` for vCenter's REST API and read-only SOAP (vim25) queries. It accepts vCenter's self-signed certificate and holds the vCenter sessions. Credentials never reach the website's server.

## What the website does

- **Insights dashboard:** hosts, cores, storage, VMs, physical memory, the vCPU-to-core ratio, storage utilisation, capacity by datastore type, fullest datastores, and clusters. **Download HTML** saves the dashboard as a self-contained file.
- **Sheets:**

  | Sheet | Rows | Source |
  |---|---|---|
  | vInfo | one per VM | SOAP |
  | vDisk | one per virtual disk | SOAP |
  | vNetwork | one per virtual NIC | SOAP, plus REST for network names |
  | vSnapshot | one per snapshot | SOAP |
  | vHost | one per ESXi host | SOAP |
  | vCluster | one per cluster | SOAP, plus REST for HA and DRS |
  | vDatastore | one per datastore | SOAP |
  | vHealth | one per finding: NTP, NTPD, folder name, connected CD-ROM, active snapshot | SOAP |

  Sheets have sorting, filtering, and **paging** with a choice of 5, 10, 25 (the default), 50, 100, 250, 500 or all rows per page.
- **Multiple vCenters:** choose "All vCenters" or one. Every sheet gets a `VI SDK Server` column, and a vCenter that fails shows a warning while the others still load.
- **Export XLSX:** every sheet in one workbook (Verdana 9pt, black header row, frozen first row and column, AutoFilter, real dates), plus a `vMetaData` sheet. Built in the browser.
- **Topology tab:** hosts grouped by cluster, datastores, and a line for each host-to-datastore mount (hover to isolate one), plus datastore and host tables. It renders in the page in a sandboxed frame. **Download HTML** saves the same report as a self-contained file for emailing or archiving.
- **API Explorer:** send any REST request or read-only SOAP operation through the helper, to see a response before building a sheet on it.

Queries are cached per vCenter, so switching sheets doesn't query vCenter again. **Refresh** fetches fresh data.

## Run the helper (development)

Prerequisites: Rust (stable) and Node 18+. On Linux, also install the [Tauri system packages](https://v2.tauri.app/start/prerequisites/#linux) plus `libayatana-appindicator3-dev` for the tray icon.

```bash
cd helper
npm install
npm run dev
```

The first time it runs with no settings, the window opens. Click **Add vCenter**, enter the details, and click **Save & test**; the test checks both the REST and SOAP logins. Repeat for each vCenter; every entry has **Test**, **Edit**, and **Delete** buttons. Closing the window leaves the helper running in the tray. Use the tray menu to reopen settings or quit. Quitting logs out of every vCenter session.

Where things are stored:

| What | Where |
|---|---|
| Settings (vCenters, allowed websites, port) | `config.json` in the OS app-config dir (e.g. `~/Library/Application Support/dev.dbhinsights.helper/` on macOS) |
| Password | OS keychain: macOS Keychain, Windows Credential Manager, Linux Secret Service. Service `dbh-insights-helper`, one account per vCenter login (`user@host`) |

## Run the website (development)

```bash
python3 -m http.server 5500 --bind 127.0.0.1
```

Run that from the project root, then open http://localhost:5500/collect/. The helper allows `https://dbh-insights.github.io`, `http://localhost:5500` and `http://127.0.0.1:5500` by default. The website needs helper 0.2.0 or later (for SOAP) and says so if an older helper is running.

## Build installers

```bash
cd helper
npm run build
```

Output goes to `helper/src-tauri/target/release/bundle/`: `.dmg`/`.app` on macOS, `.msi`/`.exe` on Windows, `.deb`/`.rpm`/`.AppImage` on Linux. Tauri can't cross-compile installers, so build on each OS, or use a GitHub Actions matrix with [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action). Unsigned builds will trigger Gatekeeper/SmartScreen warnings; sign them before handing them out widely.

The app icon (white DBH on orange) is drawn in `helper/icon-source.svg`. To change it, edit the SVG, then regenerate the PNG and every icon size:

```bash
cd helper
rsvg-convert -w 1024 -h 1024 icon-source.svg -o icon-source.png
npm run icons
```

`npm run icons` also creates Android and iOS icons under `src-tauri/icons/`; they aren't used, so you can delete those folders.

## Deploy the website

Copy the files in `collect/` to your web server. They're static, so any host works (GitHub Pages, Netlify, S3, IIS, nginx), and they use relative links, so the folder can sit anywhere, for example `https://example.com/collect/`. Link to the URL with the trailing slash; most servers redirect `/collect` to `/collect/` automatically. The published site, `https://dbh-insights.github.io`, is allowed by default, so users of that site don't need to change anything. If you host a copy somewhere else, each user adds that site's origin (for example `https://insights.example.com`, with no trailing path) under **Websites allowed to use this helper**. Until they do, the site shows exactly what to add.

## Website code

| File | Purpose |
|---|---|
| `helper-client.js` | Calls the helper: `status()`, `call()` for REST, `soap()` for SOAP |
| `vim.js` | vim25 querying: `retrieve(api, type, props)` over a ContainerView, following continuation tokens |
| `sheets.js` | `VcenterData` (cached per-vCenter queries) and the `SHEETS` definitions |
| `insights.js` | Topology and the dashboard rollup |
| `xlsx.js` | Dependency-free .xlsx writer |
| `report.js` | Topology report HTML |
| `insights-report.js` | Insights dashboard as a standalone HTML file |
| `app.js` | UI: navigation, tables and paging, dashboard, export, explorer |

## Adding a sheet

Add an entry to `SHEETS` in `collect/sheets.js`:

```js
{
  name: "vRP",
  group: "Hosts & clusters",
  columns: [col.text("Resource Pool name"), col.number("CPU limit"), col.text("Status")],
  async rows(d) {
    const pools = await retrieve(d.api, "ResourcePool", ["name", "config.cpuAllocation.limit", "overallStatus"]);
    return pools.map((p) => [p.str("name"), p.num("config.cpuAllocation.limit"), p.str("overallStatus")]);
  },
}
```

`rows(d)` runs once per selected vCenter. `d.api` is bound to that vCenter (`get`, `call`, `soap`), and `d` also offers shared cached queries (`vmInventory()`, `vmDevices()`, `hosts()`, `clusters()`, `datastores()`, `restClusters()`, `restNetworks()`); reuse those rather than querying the same objects again. The `VI SDK Server` column, multi-vCenter merging, sorting, paging, filtering, and the XLSX export all pick the new sheet up automatically.

Look at a response in the **API Explorer** first. In vim25 SOAP responses, members of a top-level array property are named after the declared type (`<VirtualDevice xsi:type="VirtualDisk">`), not the field name. Use `ManagedObject.array()` and `xsiType()` rather than element names.

## Helper API

`GET /status`
```json
{ "helper": "dbh-insights-helper", "version": "0.2.0", "originAllowed": true,
  "configured": true, "capabilities": ["rest", "soap"],
  "vcenters": [
    { "id": "vc-1a2b3c", "name": "Lab", "host": "vcsa.lab.local", "username": "administrator@vsphere.local" }
  ] }
```

`POST /proxy` (REST) with `Content-Type: application/json`
```json
{ "vcenter": "vc-1a2b3c", "method": "GET", "path": "/api/vcenter/vm?power_states=POWERED_ON" }
```

`POST /soap` (read-only vim25) with `Content-Type: application/json`
```json
{ "vcenter": "vc-1a2b3c",
  "body": "<vim25:RetrieveServiceContent><vim25:_this type=\"ServiceInstance\">ServiceInstance</vim25:_this></vim25:RetrieveServiceContent>" }
```
The helper wraps `body` in a SOAP envelope, adds its session cookie (logging in again if the session expired), and returns vCenter's XML. The `vim25`, `xsi`, and `soapenv` prefixes are declared by the envelope.

`vcenter` is the id from `/status`. You can leave it out when only one vCenter is configured. vCenter's status code and body are returned unchanged. Errors raised by the helper itself carry an `X-Helper-Error` header and look like `{"error":{"kind":"...","message":"..."}}`. The possible kinds are `origin_not_allowed`, `not_configured`, `vcenter_required`, `unknown_vcenter`, `vcenter_auth_failed`, `vcenter_unreachable`, `read_only`, `bad_path`, `soap_not_allowed`, `bad_request`, and `forbidden_host`.

Try it with curl (requests with no `Origin` header, which means local tools, are allowed):

```bash
curl -s -H 'Content-Type: application/json' -d '{"path":"/api/vcenter/vm"}' http://127.0.0.1:8765/proxy
```

## Security model

- The helper listens on **127.0.0.1 only** and rejects requests whose `Host` isn't `127.0.0.1` or `localhost`, which blocks DNS-rebinding attacks.
- **Origin allowlist.** Any web page can reach localhost, so only websites the user has listed can use `/proxy` and `/soap`. Other sites see only `originAllowed: false`.
- **Local files are off by default.** A page opened from a file (`file://`) reaches the helper with the origin `null`, which any website can also produce from a sandboxed frame. So `null` can't be added to the websites list; instead the helper has a separate **Allow the website when opened from a local file** setting. While it's on, any page could use the helper, so turn it on only while you need it, or serve `collect/` with a local web server.
- **REST is read-only.** The helper only pulls data: it passes GET requests through and refuses POST, PUT, PATCH, and DELETE. There's no setting to allow writes.
- **REST path rules.** Only `/api/…` and `/rest/…` are allowed. The session endpoints are off-limits, so a page can't read or revoke the helper's token, and paths can't redirect to another host.
- **SOAP is always read-only.** The body is parsed as XML and must be exactly one of `RetrieveServiceContent`, `RetrievePropertiesEx`, `ContinueRetrievePropertiesEx`, `CancelRetrievePropertiesEx`, `CreateContainerView`, or `DestroyView`. Login, Logout, and anything that changes vCenter are refused; so are DOCTYPEs, a second operation, and attempts to close the envelope.
- **Session hygiene.** vCenter keeps abandoned sessions for about 30 minutes, so the helper logs out of REST and SOAP when a vCenter is edited, deleted, or re-tested, and when the helper quits.
- The password stays in the OS keychain. It is never written to disk or returned to the settings window or the website. It's XML-escaped when sent in the SOAP login.
- The website never renders vCenter text with `innerHTML`, so VM names and annotations can't inject script.

## Browser notes

- **Chrome/Edge**: calls from a public site to localhost go through Private Network Access / Local Network Access. The helper sends the required `Access-Control-Allow-Private-Network` preflight header. Newer Chrome versions also show a one-time "access devices on your local network" prompt, which the user should allow.
- **Firefox**: works; `http://127.0.0.1` counts as a secure context, so an `https://` site can call it.
- **Safari**: WebKit has historically blocked `https://` pages from calling `http://127.0.0.1` as mixed content. Test on your Safari version. If it's blocked, Safari users need a Chromium browser or Firefox, or the helper needs a locally trusted certificate.

## Requirements and limits

- vCenter 7.0 U2 or later, because the helper uses the `/api/session` REST API.
- vCLS VMs are excluded everywhere, matching the vSphere UI. VM templates are included in vInfo (flagged in the Template column); the REST VM list leaves them out, so REST and vInfo counts can differ by the number of templates.
- Not implemented: datastore file browsing (zombie VMDK detection, vFileInfo) and multipath details, which use different vCenter API areas.
