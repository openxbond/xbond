<p align="center">
  <img src="apps/dashboard/public/favicon.svg" width="96" alt="XBond" />
</p>

<h1 align="center">XBond</h1>

<p align="center">Cross-platform network proxy client · Desktop / Mobile / CLI / Web / Docker</p>

<div align="center">

[![License](https://img.shields.io/github/license/openxbond/xbond?style=flat-square)](LICENSE) [![CI](https://github.com/openxbond/xbond/actions/workflows/ci.yml/badge.svg)](https://github.com/openxbond/xbond/actions/workflows/ci.yml) [![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS-525B6C?style=flat-square)](https://github.com/openxbond/xbond/releases)

</div>

[繁體中文](README.md) | English | [简体中文](README.zh-CN.md) | [조선어](README.ko.md) | [فارسی](README.fa.md)

XBond takes care of the proxy loop for you: import your connection configs, bring the connection up, pick a routing strategy, and watch what your network is doing. The [mihomo](https://github.com/MetaCubeX/mihomo) and [sing-box](https://github.com/SagerNet/sing-box) cores ship embedded, so Clash YAML and sing-box JSON configs run as-is — and third-party subscriptions work fully without an XBond account.

## Features

- **One client, every platform**: desktop apps (Windows 10+, macOS, Linux), mobile apps (Android, iOS), a CLI, a web console and a Docker image — all sharing the same capabilities and domain semantics.
- **Dual-core engine**: mihomo and sing-box come embedded; whichever matches your config is the one that runs, so Clash YAML and sing-box JSON both work natively.
- **Subscriptions, with or without an account**: third-party subscriptions (a token, a URL, or a local profile file) work out of the box. Signing in to XBond Cloud adds account-based subscriptions and service perks on top.
- **Three ways to capture traffic**: system proxy, TUN, or port-only — switch to fit your device's permissions and the situation at hand. An unprivileged user session can delegate TUN to a machine-level service.
- **Honest, three-layer status**: core reachability, traffic capture and outbound connectivity are three separate facts, shown separately. Disconnected, loading and failed never masquerade as connected.
- **See your network activity**: a live connection log, routing rules, DNS queries and traffic counters.
- **Subscription history**: every update keeps a version — roll back, pin, or pick a direct/proxied update channel per subscription.
- **A proper background service**: the daemon registers as a system service (user or machine scope) and starts with your system. An instance lock guarantees a single daemon per data directory, and shutdown is graceful.
- **Remote management**: add external core controllers from the desktop or web UI and switch control targets — remote proxy instances join the same interface.
- **Diagnostics built in**: `doctor` checks your environment and permissions; `bugreport` exports a diagnostic bundle with credentials fully redacted.
- **Updates and languages**: `xbond upgrade` or the desktop in-app updater. The UI ships in 繁體中文, 简体中文, English, 한국어 and فارسی.

## Download

Installers and update manifests publish on the [download page](https://openxbond.github.io/xbond/download/); [GitHub Releases](https://github.com/openxbond/xbond/releases) carry the same artifacts with SHA256 checksums.

| Platform | Form |
| --- | --- |
| Windows 10+ | Desktop app (NSIS installer) |
| macOS | Desktop app (DMG) |
| Linux | Desktop app (deb / rpm / AppImage) |
| Android | Per-ABI APKs (arm64-v8a etc.) plus a universal build; traffic captured as a VPN |
| iOS | TestFlight |
| CLI | Standalone binaries for Windows / macOS / Linux (amd64 / arm64) |
| Docker | `ghcr.io/openxbond/xbond` (amd64 / arm64) |

## Quick start

### Desktop

1. Install the desktop app for your platform from the [download page](https://openxbond.github.io/xbond/download/) and launch it — the first launch registers and starts the local service.
2. Sign in to an XBond account, or import a third-party subscription.
3. Pick a traffic-capture mode and switch the connection on.

### CLI

```console
$ xbond daemon install             # register and start the local service (--scope system installs a machine-level service)
$ xbond login                      # sign in to an XBond account (--device for headless environments)
$ xbond sub add <token|url|file>   # add a third-party subscription
$ xbond up                         # start the proxy core
$ xbond status                     # three-layer status, subscriptions and traffic
```

Common commands at a glance:

| Command | Purpose |
| --- | --- |
| `daemon install [--scope user\|system]` · `start` · `stop` · `restart` · `status` · `uninstall` | Install and manage the local service |
| `login [--device]` · `logout` | Sign in/out of an XBond account; `--device` walks through the device-code flow for headless environments |
| `sub add <token\|url\|file>` · `list` · `use` · `update` · `info` · `remove` | Add and manage third-party subscriptions |
| `sub versions` · `rollback` · `unpin` · `channel` · `edit` · `export` | Roll back subscription versions, pin them, choose an update channel |
| `up` · `down` · `mode [sysproxy\|tun\|port]` | Bring the connection up or down, view or switch the capture mode |
| `node list` · `select` · `test` | Policy groups and node management, latency testing |
| `status` · `conns` · `rules` · `dns` · `logs` | Three-layer status and network activity observation |
| `env` | Print proxy variables for the terminal session |
| `doctor` · `bugreport` | Environment self-check and redacted diagnostic bundle |
| `run --config <file>` | Run a standalone config in the foreground, without the daemon |
| `upgrade [--check]` · `version` · `web` | Check for updates, version info and the local web console |

### Docker

Copy the Docker deployment command from the XBond Cloud subscription page and you're up in port or Linux gateway mode with your subscription attached. The Compose example in this repository works too:

```console
$ docker compose up -d
```

Open `http://localhost:19090` to sign in to XBond Cloud or import a subscription; `SUB_URL` can be set before the first start instead. Config and sign-in state live in the `/data` volume, the active subscription refreshes itself, and the default mixed proxy listens on `127.0.0.1:7890`. To update the container version, run `docker compose up -d --pull always`.

For local development, run `docker build -t ghcr.io/openxbond/xbond:local .`, then `XBOND_IMAGE_TAG=local docker compose up -d --pull never`. See the [Docker behavior contract](docs/specs/docker-daemon.md).

## Servers and headless environments

XBond is at home on machines without a desktop:

- **Headless sign-in**: `xbond login --device` walks through the OAuth device-code flow — for Docker, SSH and headless hosts.
- **Remote management**: the web console manages the local machine and doubles as the UI for external core controllers — add a remote instance address on the desktop or web app to switch control targets.
- **SSH tunnel**: the remote daemon's management port stays on loopback; `ssh -L 19090:127.0.0.1:19090 user@host` opens the remote management UI in your local browser. Anyone who can reach the UI can manage the daemon — don't expose the management port to untrusted networks.

To refresh the image on a schedule, schedule it on the Docker host under an account with Docker permissions, pointing at the directory that holds the Compose file:

```cron
0 4 * * * cd /path/to/xbond && docker compose up -d --pull always
```

## Accounts and subscriptions

The XBond client itself sells nothing. Sign-in, plans and service perks are handled in the XBond Cloud console; skipping sign-in doesn't limit third-party subscriptions or remote control.

## Troubleshooting

1. Run `xbond status` and walk the three layers one by one: core reachability, traffic capture, outbound connectivity.
2. Run `xbond doctor` to self-check the environment and permissions, and follow its guidance.
3. When filing an issue, attach the bundle from `xbond bugreport` — credentials are fully redacted: no subscription URLs, tokens or LocalAPI credentials inside.

## Development

This repository uses a pnpm + Go + Rust toolchain; `pnpm setup` installs everything in one go. Platform toolchains and daily commands:

- [Development environment](docs/dev-env.md): toolchains and daily entry points for web, desktop, mobile and CLI.
- [AGENTS.md](AGENTS.md): repository structure, development commands and shared rules.
- [Client system](docs/architecture/client-system.md): hosts, shared capabilities and cross-repo contracts.
- [Dev pipeline](docs/specs/dev-pipeline.md): entry routing, implementation, UI, review and maintenance.
- [Verification matrix](docs/agents/verification.md): commands and platform acceptance by change scope.
- [Release manual](docs/release.md): signing, acceptance and the release process.

UI strings live per language in [`packages/client-ui/src/i18n/messages/`](packages/client-ui/src/i18n/messages/), CLI strings in `internal/i18n/locales/` — improvements to existing languages and new languages are welcome.

## License

XBond is released under the [GNU Affero General Public License v3](LICENSE). The embedded mihomo and sing-box use GPL-3.0-family licenses; the combined work is conveyed under AGPL-3.0 via GPLv3 §13. Third-party components and their licenses are listed in [third-party notices](THIRD-PARTY-NOTICES.md).

---

This file is a translation of [README.md](README.md) (canonical). Update the source first when content changes.
