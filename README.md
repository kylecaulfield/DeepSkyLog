# DeepSkyLog

Self-hosted observation log and photo tracker for deep-sky astronomy. Upload an
image, let the server pull EXIF (date, GPS, telescope) and match it against a
seeded Messier + Caldwell catalog, track your progress toward completing each
list, and publish a public gallery and map of where you image from.

## Features

- Dashboard showing % completion for every observing list.
- Full object tables (110 Messier, 109 Caldwell seeded on first run) with
  observed rows highlighted and filters for status / type / free text.
- Photo gallery filterable by telescope and object type.
- Per-object pages with hero photo, RA/Dec metadata, and list memberships.
- Leaflet map of imaging locations, driven by EXIF GPS.
- Admin UI behind HTTP Basic Auth: drag-and-drop uploads, EXIF preview,
  autocomplete over the seeded catalogs, 1–5 star ratings.
- Automatic telescope detection for Seestar S50 / S30 Pro / S30; 12″ Dobsonian
  and anything else is picked manually.
- CSV export of every observation.
- `backup.sh` snapshots the SQLite database + uploads to a timestamped tarball.

## Architecture at a glance

```
                            ┌──────────────────────────┐
 browser  ──────────────►   │ Express 4 (server.js)    │
 (public)                   │                          │
                            │  ├── / (public static)   │
                            │  │    public/*.html + js │
                            │  ├── /api/*  (read-only) │
                            │  ├── /admin  (static)    │──── HTTP Basic Auth
                            │  └── /api/admin/* (RW)   │     + IP rate-limit
                            │                          │
                            │  sharp  → thumbnails     │
                            │  exifr  → EXIF / GPS     │
                            │  multer → uploads        │
                            └──────────┬───────────────┘
                                       │ better-sqlite3
                                       ▼
 data/deepskylog.sqlite  (WAL)   uploads/YYYY/MM/<slug>/   data/stage/
 ┌ observations                  ├── original-<rand>.jpg   (in-flight admin
 ├ lists (seeded: messier,       └── thumb-<rand>.jpg       uploads, auth-only)
 │        caldwell)
 ├ list_objects (219 rows
 │        pre-populated)
 └ list_completions (junction)
```

### Request flow for an upload

1. Admin drops a file on `/admin/upload.html`.
2. Browser `POST /api/admin/stage` (multipart). `multer` drops the file into
   `data/stage/`, `exifr` extracts metadata, `matchTelescope()` maps the EXIF
   device to a known telescope. The response includes a staged id + parsed
   metadata.
3. Admin reviews the preview and confirms the form.
4. Browser `POST /api/admin/observations` (JSON). The server renames the stage
   file to `uploads/YYYY/MM/<slug>/<rand>.<ext>`, sharp writes a 640px
   thumbnail, a transaction inserts the `observations` row and one
   `list_completions` row per matching `list_object` (so the same upload can
   tick every list the object belongs to).
5. Stale staged files are swept on startup and hourly (24h TTL).

### Directory layout

```
.
├── server.js            – Express app, all API + static mounts
├── db/
│   ├── index.js         – open + migrate + seed + EXIF-coord backfill
│   ├── schema.js        – ordered migrations list
│   └── seed/
│       ├── messier.js   – 110 objects (name, type, RA, Dec, mag, constellation)
│       └── caldwell.js  – 109 objects, same schema
├── public/              – public site (dashboard, list, gallery, map, object)
│   ├── js/
│   │   ├── common.js    – fetch + DOM helpers, RA/Dec formatting
│   │   ├── dashboard.js
│   │   ├── list.js
│   │   ├── gallery.js
│   │   ├── map.js       – Leaflet bootstrap
│   │   └── object.js
│   └── *.html
├── admin/               – admin UI, served behind Basic Auth
│   ├── index.html       – admin dashboard (stats, recent uploads)
│   ├── upload.html      – drag-and-drop uploader
│   ├── dashboard.js
│   ├── upload.js
│   └── admin.css
├── backup.sh            – tar.gz snapshot of db + uploads
├── package.json
└── .env.example
```

### Data model

| table              | purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `lists`            | Observing lists (`messier`, `caldwell`, user-created).           |
| `list_objects`     | Catalog entries (M1 … M110, C1 … C109) with RA/Dec/mag/type.     |
| `observations`     | Every logged photo: date, location, telescope, rating, EXIF …    |
| `list_completions` | Junction: each time an observation satisfies a list entry.       |
| `migrations`       | Applied migration ids (managed by `db/schema.js`).               |

`observations.latitude` / `longitude` are populated from EXIF GPS on upload and
drive the Leaflet map. An install-time backfill pulls coords from any existing
`exif_json` blobs after the migration that adds the columns.

### Public vs admin surface

| Route                        | Auth | Notes                                          |
| ---------------------------- | ---- | ---------------------------------------------- |
| `/`, `/list.html`, …         | ✗    | Public static pages.                           |
| `GET /api/lists`             | ✗    |                                                |
| `GET /api/lists/:slug`       | ✗    | Returns list + objects + observed flag.        |
| `GET /api/observations`      | ✗    | `telescope=`, `object_type=`, `has_image=1`.   |
| `GET /api/observations/map`  | ✗    | Only rows with non-null lat/lon.               |
| `GET /api/observations.csv`  | ✗    | Downloadable snapshot.                         |
| `GET /api/objects/:id`       | ✗    | Object + memberships + observations.           |
| `GET /api/filters`           | ✗    | Distinct telescopes + object types.            |
| `/admin/*` (static)          | Basic | Dashboard + upload UI.                        |
| `GET /api/admin/stats`       | Basic | Totals + recent uploads + telescope counts.    |
| `GET /api/admin/objects`     | Basic | Autocomplete over seeded catalogs.             |
| `POST /api/admin/stage`      | Basic | Stage an upload; returns EXIF + telescope guess. |
| `GET /api/admin/stage/:id/preview` | Basic | Preview a staged file.                  |
| `DELETE /api/admin/stage/:id`| Basic | Discard an in-flight upload.                   |
| `POST /api/admin/observations`| Basic | Finalize: move file, thumbnail, insert rows.  |

Basic Auth compares the submitted password with `ADMIN_PASSWORD` using
`crypto.timingSafeEqual`. Failed attempts are counted per client IP with a
sliding 15-minute window; after 20 failures the middleware returns
`HTTP 429 Retry-After`.

---

## Hosting — step by step

### Prerequisites

- Node.js 18 or newer.
- ~150 MB free for `node_modules`, a bit more for photos.
- A reverse proxy for TLS if you expose this on the public internet
  (Caddy / nginx / Cloudflare Tunnel all work — see notes below).

### 1. Clone and install

```bash
git clone https://github.com/kylecaulfield/DeepSkyLog.git
cd DeepSkyLog
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```bash
ADMIN_PASSWORD=choose-a-long-random-password
PORT=3000
UPLOAD_DIR=./uploads
# Optional:
# STAGE_DIR=./data/stage   # in-flight admin uploads (default is under data/)
# DATABASE_PATH=./data/deepskylog.sqlite
# BACKUP_DIR=./backups
# BACKUP_KEEP=14           # number of snapshots to keep (default 14)
```

`ADMIN_PASSWORD` is required for any write operation; without it the entire
`/admin` section refuses to serve.

### 3. Run it

```bash
npm start
```

First boot runs all database migrations, seeds the 110 Messier and 109 Caldwell
objects, and creates `uploads/` and `data/stage/`. You should see:

```
DeepSkyLog listening on http://localhost:3000
Database: /.../data/deepskylog.sqlite
Upload dir: /.../uploads
```

Visit `http://localhost:3000/` for the public site and
`http://localhost:3000/admin/` to log in with the admin password (any username
works).

### 4. Upload your first observation

1. In `/admin/upload.html`, drop a JPG/PNG onto the drop zone.
2. EXIF is parsed server-side. If the camera model matches a Seestar the
   telescope is auto-selected.
3. Type the object name — the input autocompletes from the seeded catalogs.
4. Confirm date, location, rating, notes, and save.
5. The file lands in `uploads/YYYY/MM/<object-slug>/`, a thumbnail is
   generated, and the matching catalog entry is marked observed on the public
   dashboard.

### 5. Run as a service (systemd)

Create `/etc/systemd/system/deepskylog.service`:

```ini
[Unit]
Description=DeepSkyLog
After=network.target

[Service]
Type=simple
User=deepsky
WorkingDirectory=/opt/DeepSkyLog
EnvironmentFile=/opt/DeepSkyLog/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now deepskylog
sudo journalctl -u deepskylog -f
```

### 6. Put it behind a reverse proxy (Caddy example)

```caddy
deepsky.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

Caddy will fetch and renew TLS automatically. The important bits for any proxy:

- Forward to the local `PORT` you chose.
- Preserve the `Authorization` header (default).
- Allow large request bodies (default limit in the app is 50 MB).

### 7. Backups

```bash
./backup.sh
```

Writes `backups/deepskylog-<UTC-stamp>.tar.gz` containing:

- The SQLite database, snapshotted via `sqlite3 .backup` when the CLI is
  available (falls back to a file copy of the `.sqlite` + `-wal` + `-shm`).
- The `uploads/` tree, minus `.stage/`.
- A `.sha256` sidecar next to the archive.

Archives older than `BACKUP_KEEP` (default 14) are pruned automatically. Hook
into cron for daily snapshots:

```cron
0 3 * * * cd /opt/DeepSkyLog && ./backup.sh >> /var/log/deepskylog-backup.log 2>&1
```

Restore is just:

```bash
systemctl stop deepskylog
tar -xzf deepskylog-<stamp>.tar.gz -C /opt/DeepSkyLog/data ./deepskylog.sqlite
tar -xzf deepskylog-<stamp>.tar.gz -C /opt/DeepSkyLog ./uploads
systemctl start deepskylog
```

### 8. Upgrading

Migrations are additive and idempotent — they run on every boot and track
applied ids in a `migrations` table.

```bash
cd /opt/DeepSkyLog
git pull
npm install
systemctl restart deepskylog
```

Take a backup first; always.

---

## Docker

An OCI image is published on every push to `main` at
`ghcr.io/kylecaulfield/deepskylog`, built for `linux/amd64` and `linux/arm64`
by `.github/workflows/docker.yml`. Tags:

- `latest` — tip of `main`.
- `main` — alias of the above.
- `<shortsha>` — the exact commit.

All mutable state lives under `/data` inside the container (database + staged
uploads + finalized uploads + backup archives), so one bind mount is enough.

### Quick start with `docker run`

```bash
mkdir -p /srv/deepskylog/data
# The image runs as UID 1000 (the `node` user). Make sure the host dir matches.
sudo chown -R 1000:1000 /srv/deepskylog/data

docker run -d \
  --name deepskylog \
  -p 3000:3000 \
  -e ADMIN_PASSWORD='change-me' \
  -v /srv/deepskylog/data:/data \
  --restart unless-stopped \
  ghcr.io/kylecaulfield/deepskylog:latest
```

### docker-compose

```yaml
services:
  deepskylog:
    image: ghcr.io/kylecaulfield/deepskylog:latest
    container_name: deepskylog
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      ADMIN_PASSWORD: change-me
      # PORT: 3000        # override the in-container port
      # BACKUP_KEEP: 14
    volumes:
      - ./data:/data
```

### Hosting on Unraid

The image doesn't ship with a Community Apps template yet, so add it manually
as a custom container. Copy-paste values into the corresponding fields in
Unraid's Docker → **Add Container** dialog.

1. **Prepare the appdata directory** (Unraid terminal or SSH as root):

   ```bash
   mkdir -p /mnt/user/appdata/deepskylog
   chown -R 1000:1000 /mnt/user/appdata/deepskylog
   ```

   The container runs as UID 1000, so the appdata dir has to be owned by 1000
   or readable+writable by it. Unraid's default `nobody:users` (99:100) will
   produce permission errors on first run; do not skip this step.

2. **Docker → Add Container**. Switch template mode to **Basic** and fill in:

   | Field                | Value                                                      |
   | -------------------- | ---------------------------------------------------------- |
   | Name                 | `deepskylog`                                               |
   | Repository           | `ghcr.io/kylecaulfield/deepskylog:latest`                  |
   | Network Type         | `Bridge`                                                   |
   | Icon URL             | (optional) any square PNG                                  |
   | WebUI                | `http://[IP]:[PORT:3000]/`                                 |
   | Extra Parameters     | `--init` (reaps zombies cleanly)                           |

3. Click **Add another Path, Port, Variable, Label or Device** and add:

   **Port**
   - Name: `WebUI`
   - Container Port: `3000`
   - Host Port: `3000` (change if it clashes with another container)
   - Connection Type: `TCP`

   **Path**
   - Name: `Data`
   - Container Path: `/data`
   - Host Path: `/mnt/user/appdata/deepskylog`
   - Access Mode: `Read/Write`

   **Variable (required)**
   - Name: `ADMIN_PASSWORD`
   - Key: `ADMIN_PASSWORD`
   - Value: a long random password of your choice

   **Variable (optional)**
   - Name: `BACKUP_KEEP`
   - Key: `BACKUP_KEEP`
   - Default: `14`

4. Click **Apply**. Unraid pulls the image, creates the container, and starts
   it. Watch Docker → deepskylog → **Log** until you see
   `DeepSkyLog listening on http://localhost:3000`.

5. Open `http://<UNRAID-IP>:3000/` for the public site. Go to
   `/admin/` (`http://<UNRAID-IP>:3000/admin/`) and log in with any username
   and the `ADMIN_PASSWORD` you set.

#### Persistence layout on Unraid

Everything lives under `/mnt/user/appdata/deepskylog/`:

```
deepskylog/
├── deepskylog.sqlite        # the SQLite database
├── deepskylog.sqlite-wal    # WAL journal (safe to snapshot)
├── deepskylog.sqlite-shm
├── uploads/                 # YYYY/MM/<object-slug>/<image>.jpg
│   └── …
├── stage/                   # in-flight admin uploads (auto-swept after 24h)
└── backups/                 # written by ./backup.sh if you run it
```

#### Backups

You have two options:

- **Preferred:** back up `/mnt/user/appdata/deepskylog/` with **CA Backup /
  Restore Appdata** on your preferred schedule. Stop the container first (the
  CA plugin does this for you).
- **Inside the container:** `docker exec -u node deepskylog ./backup.sh`
  produces a tarball at `/data/backups/deepskylog-<UTC>.tar.gz` which you can
  then sync off-box.

#### Updates

Click Docker → deepskylog → **Force update** (Unraid pulls the newest
`:latest` tag and recreates the container). Migrations are additive and run on
every boot.

#### Reverse proxy

Point SWAG / Nginx Proxy Manager at `http://<UNRAID-IP>:3000` and put DeepSkyLog
behind your existing TLS certificate. Preserve the `Authorization` header
(default in both proxies) and allow at least 50 MB request bodies so the
admin upload form works.

---

## Development

```bash
npm run dev   # node --watch server.js
```

The public site is plain HTML/CSS/ES-modules — no build step. Edit any file
under `public/` or `admin/` and refresh.

### Local data reset

```bash
rm -rf data uploads
npm start
```

The next start re-runs migrations and reseeds the Messier + Caldwell lists.

### Environment variables

| Variable         | Default                          | Purpose                               |
| ---------------- | -------------------------------- | ------------------------------------- |
| `PORT`           | `3000`                           | HTTP port.                            |
| `ADMIN_PASSWORD` | — (required for writes)          | Basic Auth password for `/admin`.     |
| `UPLOAD_DIR`     | `./uploads`                      | Where final photos + thumbnails live. |
| `STAGE_DIR`      | `<db dir>/stage`                 | Where staged uploads live (non-public). |
| `DATABASE_PATH`  | `./data/deepskylog.sqlite`       | SQLite file path.                     |
| `BACKUP_DIR`     | `./backups`                      | Where `backup.sh` writes archives.    |
| `BACKUP_KEEP`    | `14`                             | Number of archives to retain.         |

## License

MIT.
